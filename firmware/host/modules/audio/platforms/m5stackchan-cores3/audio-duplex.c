/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include "mc.defines.h"
#include "builtinCommon.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "driver/i2s_std.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"

#include <math.h>

#include "audio-aec.h"

#define AUDIO_DUPLEX_I2S_PORT I2S_NUM_1
#define AUDIO_DUPLEX_MCLK_PIN 0
#define AUDIO_DUPLEX_BCLK_PIN 34
#define AUDIO_DUPLEX_WS_PIN 33
#define AUDIO_DUPLEX_DATA_OUT_PIN 13
#define AUDIO_DUPLEX_DATA_IN_PIN 14

#define AUDIO_DUPLEX_DMA_FRAMES 256
#define AUDIO_DUPLEX_INPUT_RING_BYTES (64 * 1024)
#define AUDIO_DUPLEX_OUTPUT_RING_BYTES (8 * 1024)
#define AUDIO_DUPLEX_AEC_RING_BYTES (32 * 1024)
#define AUDIO_DUPLEX_AEC_FRAME_SAMPLES 512
#define AUDIO_DUPLEX_AEC_MAX_REFERENCE_DELAY_SAMPLES 4096
#define AUDIO_DUPLEX_AEC_MAX_DIAGNOSTIC_SAMPLES (16000 * 10)
#define AUDIO_DUPLEX_AEC_STATS_INTERVAL_CALLS 8
#define AUDIO_DUPLEX_IO_TIMEOUT_MS 50
#define AUDIO_DUPLEX_TASK_STACK (4096 + 1024)
#define AUDIO_DUPLEX_TASK_PRIORITY 10
#define AUDIO_DUPLEX_AEC_TASK_STACK (10 * 1024)
#define AUDIO_DUPLEX_AEC_TASK_PRIORITY 11
/* Keep the 32 ms AEC deadline away from the ESP-IDF Wi-Fi/Bluetooth work on Core 0. */
#define AUDIO_DUPLEX_REALTIME_CORE 1

enum {
	kAudioDuplexStateActive = 0,
	kAudioDuplexStateClosing = 1,
	kAudioDuplexStateTerminated = 2,
};

typedef struct AudioDuplexRingRecord {
	uint8_t *data;
	uint32_t size;
	uint32_t readOffset;
	uint32_t writeOffset;
	uint32_t used;
} AudioDuplexRingRecord;

typedef struct AudioDuplexRecord AudioDuplexRecord;
typedef AudioDuplexRecord *AudioDuplex;

struct AudioDuplexRecord {
	xsMachine *the;
	xsSlot object;
	xsSlot *onReadable;
	xsSlot *onWritable;

	i2s_chan_handle_t txHandle;
	i2s_chan_handle_t rxHandle;
	SemaphoreHandle_t mutex;
	volatile TaskHandle_t txTask;
	volatile TaskHandle_t rxTask;
	volatile TaskHandle_t aecTask;

	volatile uint8_t state;
	volatile uint8_t busStarted;
	uint8_t inputStarted;
	uint8_t outputStarted;
	uint8_t aecEnabled;
	uint8_t xsCore;
	uint8_t realtimeCore;
	uint8_t inputCallbackPending;
	uint8_t outputCallbackPending;

	uint8_t inputChannels;
	uint8_t outputChannels;
	uint16_t sampleRate;
	uint16_t aecFrameSamples;
	uint16_t aecReferenceDelaySamples;
	double volume;
	int16_t volumeFixed;

	AudioDuplexRingRecord inputRing;
	AudioDuplexRingRecord outputRing;
	AudioDuplexRingRecord aecMicrophoneRing;
	AudioDuplexRingRecord aecReferenceRing;
	StackchanAudioAec aec;
	int16_t *aecDiagnosticData;
	uint32_t aecDiagnosticCapacitySamples;
	uint32_t aecDiagnosticSamples;
	uint32_t aecDiagnosticReadOffset;
	uint32_t aecEpoch;

	uint64_t capturedFrames;
	uint64_t renderedFrames;
	uint64_t inputOverruns;
	uint64_t outputUnderruns;
	uint64_t exactReferenceFrames;
	uint64_t aecProcessedFrames;
	uint64_t aecProcessCalls;
	uint64_t aecMicrophoneOverruns;
	uint64_t aecReferenceOverruns;
	uint64_t aecSyncResets;
	uint64_t aecDiagnosticDroppedSamples;
	uint64_t aecLastProcessUs;
	uint64_t aecMaximumProcessUs;
	uint64_t aecTotalProcessUs;
	uint64_t aecLastCycleUs;
	uint64_t aecMaximumCycleUs;
	uint64_t aecTotalCycleUs;
	double aecMicrophoneMeanSquare;
	double aecReferenceMeanSquare;
	double aecOutputMeanSquare;
	uint16_t aecMicrophonePeak;
	uint16_t aecReferencePeak;
	uint16_t aecOutputPeak;
};

void xs_audio_duplex_destructor(void *it);
static void xs_audio_duplex_mark(xsMachine *the, void *it, xsMarkRoot markRoot);
static void audioDuplexInputTask(void *refcon);
static void audioDuplexOutputTask(void *refcon);
static void audioDuplexAecTask(void *refcon);
static void audioDuplexDeliverInput(void *the, void *refcon, uint8_t *message, uint16_t messageLength);
static void audioDuplexDeliverOutput(void *the, void *refcon, uint8_t *message, uint16_t messageLength);

static const xsHostHooks xsAudioDuplexHooks = {
	xs_audio_duplex_destructor,
	xs_audio_duplex_mark,
	C_NULL,
};

static uint32_t audioDuplexRingFree(const AudioDuplexRingRecord *ring)
{
	return ring->size - ring->used;
}

static void audioDuplexRingClear(AudioDuplexRingRecord *ring)
{
	ring->readOffset = 0;
	ring->writeOffset = 0;
	ring->used = 0;
}

static void audioDuplexRingDiscard(AudioDuplexRingRecord *ring, uint32_t bytes)
{
	if (bytes > ring->used)
		bytes = ring->used;
	ring->readOffset = (ring->readOffset + bytes) % ring->size;
	ring->used -= bytes;
}

static uint32_t audioDuplexRingWrite(AudioDuplexRingRecord *ring, const uint8_t *source, uint32_t bytes)
{
	uint32_t first;
	uint32_t freeBytes = audioDuplexRingFree(ring);
	if (bytes > freeBytes)
		bytes = freeBytes;
	if (!bytes)
		return 0;

	first = ring->size - ring->writeOffset;
	if (first > bytes)
		first = bytes;
	c_memcpy(ring->data + ring->writeOffset, source, first);
	if (bytes > first)
		c_memcpy(ring->data, source + first, bytes - first);
	ring->writeOffset = (ring->writeOffset + bytes) % ring->size;
	ring->used += bytes;
	return bytes;
}

static uint32_t audioDuplexRingRead(AudioDuplexRingRecord *ring, uint8_t *destination, uint32_t bytes)
{
	uint32_t first;
	if (bytes > ring->used)
		bytes = ring->used;
	if (!bytes)
		return 0;

	first = ring->size - ring->readOffset;
	if (first > bytes)
		first = bytes;
	c_memcpy(destination, ring->data + ring->readOffset, first);
	if (bytes > first)
		c_memcpy(destination + first, ring->data, bytes - first);
	ring->readOffset = (ring->readOffset + bytes) % ring->size;
	ring->used -= bytes;
	return bytes;
}

static const uint8_t gAudioDuplexZeroSamples[AUDIO_DUPLEX_DMA_FRAMES * sizeof(int16_t)] = {0};

static void audioDuplexAecResetLocked(AudioDuplex audio)
{
	uint32_t remaining;

	if (!audio->aecEnabled)
		return;

	audioDuplexRingClear(&audio->aecMicrophoneRing);
	audioDuplexRingClear(&audio->aecReferenceRing);
	remaining = audio->aecReferenceDelaySamples * sizeof(int16_t);
	while (remaining) {
		uint32_t bytes = remaining;
		if (bytes > sizeof(gAudioDuplexZeroSamples))
			bytes = sizeof(gAudioDuplexZeroSamples);
		audioDuplexRingWrite(&audio->aecReferenceRing, gAudioDuplexZeroSamples, bytes);
		remaining -= bytes;
	}
	audio->aecEpoch += 1;
	audio->aecSyncResets += 1;
}

static void audioDuplexAecQueueMicrophoneLocked(
	AudioDuplex audio,
	const int16_t *samples,
	uint32_t sampleCount
)
{
	uint32_t bytes = sampleCount * sizeof(int16_t);

	if (audioDuplexRingFree(&audio->aecMicrophoneRing) < bytes) {
		audio->aecMicrophoneOverruns += 1;
		audioDuplexAecResetLocked(audio);
	}
	audioDuplexRingWrite(&audio->aecMicrophoneRing, (const uint8_t *)samples, bytes);
}

static void audioDuplexAecQueueReferenceLocked(
	AudioDuplex audio,
	const int16_t *physical,
	uint32_t frameCount
)
{
	uint32_t bytes;
	uint32_t frame;
	int16_t mono[AUDIO_DUPLEX_DMA_FRAMES];

	if (frameCount > AUDIO_DUPLEX_DMA_FRAMES)
		frameCount = AUDIO_DUPLEX_DMA_FRAMES;
	bytes = frameCount * sizeof(int16_t);
	for (frame = 0; frame < frameCount; frame++)
		mono[frame] = physical[frame * 2];

	if (audioDuplexRingFree(&audio->aecReferenceRing) < bytes) {
		audio->aecReferenceOverruns += 1;
		audioDuplexAecResetLocked(audio);
	}
	audioDuplexRingWrite(&audio->aecReferenceRing, (const uint8_t *)mono, bytes);
	audio->exactReferenceFrames += frameCount;
}

static uint16_t audioDuplexSampleMagnitude(int16_t sample)
{
	if (-32768 == sample)
		return 32768;
	return (sample < 0) ? (uint16_t)-sample : (uint16_t)sample;
}

static int16_t audioDuplexScaleSample(int16_t sample, int16_t volume)
{
	int32_t scaled = ((int32_t)sample * volume) >> 8;
	if (scaled > 32767)
		scaled = 32767;
	else if (scaled < -32768)
		scaled = -32768;
	return (int16_t)scaled;
}

static void audioDuplexMaybeFree(AudioDuplex audio)
{
	if ((kAudioDuplexStateTerminated == audio->state) &&
		!audio->inputCallbackPending && !audio->outputCallbackPending)
		c_free(audio);
}

static void audioDuplexPostInput(AudioDuplex audio)
{
	uint8_t post = 0;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	if ((kAudioDuplexStateActive == audio->state) && audio->inputStarted &&
		audio->onReadable && !audio->inputCallbackPending && audio->inputRing.used) {
		audio->inputCallbackPending = 1;
		post = 1;
	}
	xSemaphoreGive(audio->mutex);

	if (post)
		modMessagePostToMachine(audio->the, C_NULL, 0, audioDuplexDeliverInput, audio);
}

static void audioDuplexPostOutput(AudioDuplex audio)
{
	uint8_t post = 0;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	if ((kAudioDuplexStateActive == audio->state) && audio->outputStarted &&
		audio->onWritable && !audio->outputCallbackPending && audioDuplexRingFree(&audio->outputRing)) {
		audio->outputCallbackPending = 1;
		post = 1;
	}
	xSemaphoreGive(audio->mutex);

	if (post)
		modMessagePostToMachine(audio->the, C_NULL, 0, audioDuplexDeliverOutput, audio);
}

static esp_err_t audioDuplexEnableBus(AudioDuplex audio)
{
	esp_err_t err;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	if (audio->busStarted) {
		xSemaphoreGive(audio->mutex);
		return ESP_OK;
	}
	xSemaphoreGive(audio->mutex);

	err = i2s_channel_enable(audio->rxHandle);
	if (ESP_OK != err)
		return err;
	err = i2s_channel_enable(audio->txHandle);
	if (ESP_OK != err) {
		i2s_channel_disable(audio->rxHandle);
		return err;
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->busStarted = 1;
	xSemaphoreGive(audio->mutex);

	xTaskNotifyGive(audio->rxTask);
	xTaskNotifyGive(audio->txTask);
	return ESP_OK;
}

static void audioDuplexDisableBus(AudioDuplex audio)
{
	uint8_t wasStarted;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	wasStarted = audio->busStarted;
	audio->busStarted = 0;
	xSemaphoreGive(audio->mutex);

	if (!wasStarted)
		return;

	i2s_channel_disable(audio->txHandle);
	i2s_channel_disable(audio->rxHandle);
}

static void audioDuplexUpdateBus(AudioDuplex audio)
{
	uint8_t shouldRun;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	shouldRun = audio->inputStarted || audio->outputStarted;
	xSemaphoreGive(audio->mutex);

	if (!shouldRun)
		audioDuplexDisableBus(audio);
}

static void audioDuplexRelease(AudioDuplex audio)
{
	if (!audio || (kAudioDuplexStateActive != audio->state))
		return;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->state = kAudioDuplexStateClosing;
	audio->inputStarted = 0;
	audio->outputStarted = 0;
	if (audio->rxTask)
		xTaskNotifyGive(audio->rxTask);
	if (audio->txTask)
		xTaskNotifyGive(audio->txTask);
	if (audio->aecTask)
		xTaskNotifyGive(audio->aecTask);
	xSemaphoreGive(audio->mutex);

	audioDuplexDisableBus(audio);

	while (audio->rxTask || audio->txTask || audio->aecTask)
		modDelayMilliseconds(1);

	if (audio->txHandle) {
		i2s_del_channel(audio->txHandle);
		audio->txHandle = C_NULL;
	}
	if (audio->rxHandle) {
		i2s_del_channel(audio->rxHandle);
		audio->rxHandle = C_NULL;
	}

	if (audio->mutex) {
		vSemaphoreDelete(audio->mutex);
		audio->mutex = C_NULL;
	}
	if (audio->inputRing.data) {
		c_free(audio->inputRing.data);
		audio->inputRing.data = C_NULL;
	}
	if (audio->outputRing.data) {
		c_free(audio->outputRing.data);
		audio->outputRing.data = C_NULL;
	}
	if (audio->aecMicrophoneRing.data) {
		c_free(audio->aecMicrophoneRing.data);
		audio->aecMicrophoneRing.data = C_NULL;
	}
	if (audio->aecReferenceRing.data) {
		c_free(audio->aecReferenceRing.data);
		audio->aecReferenceRing.data = C_NULL;
	}
	if (audio->aecDiagnosticData) {
		heap_caps_free(audio->aecDiagnosticData);
		audio->aecDiagnosticData = C_NULL;
	}
	if (audio->aec) {
		stackchanAudioAecDestroy(audio->aec);
		audio->aec = C_NULL;
	}

	if (audio->inputCallbackPending || audio->outputCallbackPending)
		audio->state = kAudioDuplexStateTerminated;
	else
		c_free(audio);
}

void xs_audio_duplex_destructor(void *it)
{
	audioDuplexRelease((AudioDuplex)it);
}

static void xs_audio_duplex_mark(xsMachine *the, void *it, xsMarkRoot markRoot)
{
	AudioDuplex audio = (AudioDuplex)it;
	if (!audio)
		return;
	if (audio->onReadable)
		(*markRoot)(the, audio->onReadable);
	if (audio->onWritable)
		(*markRoot)(the, audio->onWritable);
}

void xs_audio_duplex_constructor(xsMachine *the)
{
	AudioDuplex audio;
	i2s_chan_config_t channelConfig =
		I2S_CHANNEL_DEFAULT_CONFIG(
				AUDIO_DUPLEX_I2S_PORT,
				I2S_ROLE_MASTER
		);
	i2s_std_config_t txConfig;
	i2s_std_config_t rxConfig;
	esp_err_t err;
	uint8_t allocationFailed = 0;
	uint8_t aecInitializationFailed = 0;
	int32_t sampleRate = 24000;
	int32_t inputChannels = 1;
	int32_t outputChannels = 1;
	int32_t echoCancellation = 0;
	int32_t aecFilterLength = 4;
	int32_t aecNlpLevel = kStackchanAudioAecNlpNormal;
	int32_t aecReferenceDelaySamples = 0;
	int32_t aecDiagnosticSamples = 0;

	xsmcVars(1);
	if (xsmcArgc < 1)
		xsTypeError("options are required");
	if (xsmcGet(xsVar(0), xsArg(0), xsID("sampleRate")))
		sampleRate = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID("inputChannels")))
		inputChannels = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID("outputChannels")))
		outputChannels = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID("echoCancellation")))
		echoCancellation = xsmcToBoolean(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID("aecFilterLength")))
		aecFilterLength = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID("aecNlpLevel")))
		aecNlpLevel = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID("aecReferenceDelaySamples")))
		aecReferenceDelaySamples = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID("aecDiagnosticSamples")))
		aecDiagnosticSamples = xsmcToInteger(xsVar(0));

	if ((sampleRate < 8000) || (sampleRate > 48000))
		xsRangeError("invalid sample rate");
	if ((inputChannels != 1) && (inputChannels != 2))
		xsRangeError("invalid input channels");
	if ((outputChannels != 1) && (outputChannels != 2))
		xsRangeError("invalid output channels");
	if (echoCancellation && (16000 != sampleRate))
		xsRangeError("echo cancellation requires 16000 Hz");
	if (echoCancellation && ((1 != inputChannels) || (1 != outputChannels)))
		xsRangeError("echo cancellation requires mono input and output");
	if ((aecFilterLength < 1) || (aecFilterLength > 8))
		xsRangeError("invalid AEC filter length");
	if ((aecNlpLevel < kStackchanAudioAecNlpNormal) ||
		(aecNlpLevel > kStackchanAudioAecNlpVeryAggressive))
		xsRangeError("invalid AEC NLP level");
	if ((aecReferenceDelaySamples < 0) ||
		(aecReferenceDelaySamples > AUDIO_DUPLEX_AEC_MAX_REFERENCE_DELAY_SAMPLES))
		xsRangeError("invalid AEC reference delay");
	if ((aecDiagnosticSamples < 0) ||
		(aecDiagnosticSamples > AUDIO_DUPLEX_AEC_MAX_DIAGNOSTIC_SAMPLES))
		xsRangeError("invalid AEC diagnostic sample count");
	if (!echoCancellation && aecDiagnosticSamples)
		xsRangeError("AEC diagnostics require echo cancellation");

	audio = c_calloc(1, sizeof(AudioDuplexRecord));
	if (!audio)
		xsRangeError("not enough memory");

	audio->the = the;
	audio->object = xsThis;
	audio->state = kAudioDuplexStateActive;
	audio->sampleRate = (uint16_t)sampleRate;
	audio->inputChannels = (uint8_t)inputChannels;
	audio->outputChannels = (uint8_t)outputChannels;
	audio->aecEnabled = (uint8_t)echoCancellation;
	audio->xsCore = (uint8_t)xPortGetCoreID();
	audio->realtimeCore = AUDIO_DUPLEX_REALTIME_CORE;
	audio->aecReferenceDelaySamples = (uint16_t)aecReferenceDelaySamples;
	audio->aecDiagnosticCapacitySamples = (uint32_t)aecDiagnosticSamples;
	audio->volume = 1.0;
	audio->volumeFixed = 256;
	audio->onReadable = builtinGetCallback(the, xsID("onReadable"));
	audio->onWritable = builtinGetCallback(the, xsID("onWritable"));

	audio->inputRing.size = AUDIO_DUPLEX_INPUT_RING_BYTES;
	audio->outputRing.size = AUDIO_DUPLEX_OUTPUT_RING_BYTES;
	audio->inputRing.data = c_malloc(audio->inputRing.size);
	audio->outputRing.data = c_malloc(audio->outputRing.size);
	audio->mutex = xSemaphoreCreateMutex();
	if (!audio->inputRing.data || !audio->outputRing.data || !audio->mutex) {
		allocationFailed = 1;
		goto memory_error;
	}
	if (audio->aecEnabled) {
		audio->aecMicrophoneRing.size = AUDIO_DUPLEX_AEC_RING_BYTES;
		audio->aecReferenceRing.size = AUDIO_DUPLEX_AEC_RING_BYTES;
		audio->aecMicrophoneRing.data = c_malloc(audio->aecMicrophoneRing.size);
		audio->aecReferenceRing.data = c_malloc(audio->aecReferenceRing.size);
		audio->aec = stackchanAudioAecCreate(aecFilterLength, aecNlpLevel);
		if (!audio->aecMicrophoneRing.data || !audio->aecReferenceRing.data || !audio->aec) {
			aecInitializationFailed = 1;
			goto memory_error;
		}
		audio->aecFrameSamples = stackchanAudioAecGetFrameSamples(audio->aec);
		if ((AUDIO_DUPLEX_AEC_FRAME_SAMPLES != audio->aecFrameSamples) ||
			((audio->aecFrameSamples * sizeof(int16_t)) > audio->aecMicrophoneRing.size)) {
			aecInitializationFailed = 1;
			goto memory_error;
		}
		if (audio->aecDiagnosticCapacitySamples) {
			size_t bytes = audio->aecDiagnosticCapacitySamples * 3 * sizeof(int16_t);
			audio->aecDiagnosticData = heap_caps_malloc(
				bytes,
				MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
			);
			if (!audio->aecDiagnosticData) {
				allocationFailed = 1;
				goto memory_error;
			}
		}
		audioDuplexAecResetLocked(audio);
	}

	channelConfig.auto_clear = true;
	channelConfig.dma_desc_num = 6;
	channelConfig.dma_frame_num = AUDIO_DUPLEX_DMA_FRAMES;

	err = i2s_new_channel(&channelConfig, &audio->txHandle, &audio->rxHandle);
	if (ESP_OK != err)
		goto i2s_error;

	txConfig = (i2s_std_config_t){
		.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(sampleRate),
		.slot_cfg = I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
		.gpio_cfg = {
			.mclk = AUDIO_DUPLEX_MCLK_PIN,
			.bclk = AUDIO_DUPLEX_BCLK_PIN,
			.ws = AUDIO_DUPLEX_WS_PIN,
			.dout = AUDIO_DUPLEX_DATA_OUT_PIN,
			.din = I2S_GPIO_UNUSED,
			.invert_flags = {
				.mclk_inv = false,
				.bclk_inv = false,
				.ws_inv = false,
			},
		},
	};
	txConfig.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
	txConfig.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH;

	rxConfig = (i2s_std_config_t){
		.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(sampleRate),
		.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
		.gpio_cfg = {
			.mclk = AUDIO_DUPLEX_MCLK_PIN,
			.bclk = AUDIO_DUPLEX_BCLK_PIN,
			.ws = AUDIO_DUPLEX_WS_PIN,
			.dout = I2S_GPIO_UNUSED,
			.din = AUDIO_DUPLEX_DATA_IN_PIN,
			.invert_flags = {
				.mclk_inv = false,
				.bclk_inv = false,
				.ws_inv = false,
			},
		},
	};
	rxConfig.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
	rxConfig.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH;

	err = i2s_channel_init_std_mode(audio->txHandle, &txConfig);
	if (ESP_OK != err)
		goto i2s_error;
	err = i2s_channel_init_std_mode(audio->rxHandle, &rxConfig);
	if (ESP_OK != err)
		goto i2s_error;

	if (audio->aecEnabled &&
		(pdPASS != xTaskCreatePinnedToCore(
			audioDuplexAecTask,
			"audioDuplexAEC",
			AUDIO_DUPLEX_AEC_TASK_STACK,
			audio,
			AUDIO_DUPLEX_AEC_TASK_PRIORITY,
			(TaskHandle_t *)&audio->aecTask,
			audio->realtimeCore
		)))
		goto task_error;
	if (pdPASS != xTaskCreatePinnedToCore(
		audioDuplexInputTask,
		"audioDuplexIn",
		AUDIO_DUPLEX_TASK_STACK,
		audio,
		AUDIO_DUPLEX_TASK_PRIORITY,
		(TaskHandle_t *)&audio->rxTask,
		audio->realtimeCore
	))
		goto task_error;
	if (pdPASS != xTaskCreatePinnedToCore(
		audioDuplexOutputTask,
		"audioDuplexOut",
		AUDIO_DUPLEX_TASK_STACK,
		audio,
		AUDIO_DUPLEX_TASK_PRIORITY,
		(TaskHandle_t *)&audio->txTask,
		audio->realtimeCore
	))
		goto task_error;

	xsmcSetHostData(xsThis, audio);
	xsSetHostHooks(xsThis, (xsHostHooks *)&xsAudioDuplexHooks);
	xsRemember(audio->object);
	return;

 task_error:
	audio->state = kAudioDuplexStateClosing;
	if (audio->rxTask)
		xTaskNotifyGive(audio->rxTask);
	if (audio->txTask)
		xTaskNotifyGive(audio->txTask);
	if (audio->aecTask)
		xTaskNotifyGive(audio->aecTask);
	while (audio->rxTask || audio->txTask || audio->aecTask)
		modDelayMilliseconds(1);
 i2s_error:
	if (audio->txHandle) {
		i2s_del_channel(audio->txHandle);
		audio->txHandle = C_NULL;
	}
	if (audio->rxHandle) {
		i2s_del_channel(audio->rxHandle);
		audio->rxHandle = C_NULL;
	}
 memory_error:
	if (audio->mutex)
		vSemaphoreDelete(audio->mutex);
	if (audio->inputRing.data)
		c_free(audio->inputRing.data);
	if (audio->outputRing.data)
		c_free(audio->outputRing.data);
	if (audio->aecMicrophoneRing.data)
		c_free(audio->aecMicrophoneRing.data);
	if (audio->aecReferenceRing.data)
		c_free(audio->aecReferenceRing.data);
	if (audio->aecDiagnosticData)
		heap_caps_free(audio->aecDiagnosticData);
	if (audio->aec)
		stackchanAudioAecDestroy(audio->aec);
	c_free(audio);
	if (allocationFailed)
		xsRangeError("not enough memory");
	if (aecInitializationFailed)
		xsUnknownError("unable to initialize ESP-SR AEC");
	xsUnknownError("unable to initialize CoreS3 audio duplex");
}

void xs_audio_duplex_close(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostData(xsThis);
	if (!audio)
		return;
	if (!xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks))
		return;

	xsmcSetHostData(xsThis, C_NULL);
	xsmcSetHostDestructor(xsThis, C_NULL);
	xsForget(audio->object);
	audioDuplexRelease(audio);
}

void xs_audio_duplex_start_input(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	esp_err_t err;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	if (audio->aecEnabled)
		audioDuplexAecResetLocked(audio);
	audio->inputStarted = 1;
	xSemaphoreGive(audio->mutex);

	err = audioDuplexEnableBus(audio);
	if (ESP_OK != err) {
		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		audio->inputStarted = 0;
		xSemaphoreGive(audio->mutex);
		xsUnknownError("unable to start audio input");
	}
}

void xs_audio_duplex_stop_input(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xsBooleanValue flush = (xsmcArgc > 0) ? xsmcToBoolean(xsArg(0)) : 0;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->inputStarted = 0;
	if (audio->aecEnabled)
		audioDuplexAecResetLocked(audio);
	if (flush)
		audioDuplexRingClear(&audio->inputRing);
	if (audio->aecTask)
		xTaskNotifyGive(audio->aecTask);
	xSemaphoreGive(audio->mutex);
	audioDuplexUpdateBus(audio);
}

void xs_audio_duplex_start_output(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	esp_err_t err;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->outputStarted = 1;
	xSemaphoreGive(audio->mutex);

	err = audioDuplexEnableBus(audio);
	if (ESP_OK != err) {
		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		audio->outputStarted = 0;
		xSemaphoreGive(audio->mutex);
		xsUnknownError("unable to start audio output");
	}
	audioDuplexPostOutput(audio);
}

void xs_audio_duplex_stop_output(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xsBooleanValue flush = (xsmcArgc > 0) ? xsmcToBoolean(xsArg(0)) : 0;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->outputStarted = 0;
	if (flush)
		audioDuplexRingClear(&audio->outputRing);
	xSemaphoreGive(audio->mutex);
	audioDuplexUpdateBus(audio);
}

void xs_audio_duplex_read(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xsUnsignedValue available;
	xsUnsignedValue requested;
	xsBooleanValue allocate = 1;
	uint8_t *buffer;
	uint32_t frameBytes = audio->inputChannels * sizeof(int16_t);

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	available = audio->inputRing.used;
	xSemaphoreGive(audio->mutex);

	if (!available)
		return;

	if (0 == xsmcArgc)
		requested = available;
	else if (xsReferenceType == xsmcTypeOf(xsArg(0))) {
		xsResult = xsArg(0);
		xsmcGetBufferWritable(xsResult, (void **)&buffer, &requested);
		xsmcSetInteger(xsResult, requested);
		allocate = 0;
	}
	else
		requested = xsmcToInteger(xsArg(0));

	if (!requested || (requested > available) || (requested % frameBytes))
		xsRangeError("invalid audio input read size");
	if (allocate)
		buffer = xsmcSetArrayBuffer(xsResult, C_NULL, requested);

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audioDuplexRingRead(&audio->inputRing, buffer, requested);
	xSemaphoreGive(audio->mutex);
}

void xs_audio_duplex_write(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	uint8_t *buffer;
	xsUnsignedValue bytes;
	uint32_t frameBytes = audio->outputChannels * sizeof(int16_t);

	xsmcGetBufferReadable(xsArg(0), (void **)&buffer, &bytes);
	if (!bytes || (bytes % frameBytes))
		xsRangeError("invalid audio output write size");

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	if (bytes > audioDuplexRingFree(&audio->outputRing)) {
		xSemaphoreGive(audio->mutex);
		xsUnknownError("audio output buffer full");
	}
	audioDuplexRingWrite(&audio->outputRing, buffer, bytes);
	xSemaphoreGive(audio->mutex);
}

void xs_audio_duplex_get_volume(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xsmcSetNumber(xsResult, audio->volume);
}

void xs_audio_duplex_set_volume(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	double volume = xsmcToNumber(xsArg(0));
	if (volume < 0)
		volume = 0;
	else if (volume > 1)
		volume = 1;

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->volume = volume;
	audio->volumeFixed = (int16_t)c_round(volume * 256.0);
	xSemaphoreGive(audio->mutex);
}

static void audioDuplexSetCounterResult(xsMachine *the, AudioDuplex audio, uint64_t value)
{
	(void)audio;
	xsmcSetNumber(xsResult, (xsNumberValue)value);
}

void xs_audio_duplex_get_captured_frames(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audioDuplexSetCounterResult(the, audio, audio->capturedFrames);
	xSemaphoreGive(audio->mutex);
}

void xs_audio_duplex_get_rendered_frames(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audioDuplexSetCounterResult(the, audio, audio->renderedFrames);
	xSemaphoreGive(audio->mutex);
}

void xs_audio_duplex_get_input_overruns(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audioDuplexSetCounterResult(the, audio, audio->inputOverruns);
	xSemaphoreGive(audio->mutex);
}

void xs_audio_duplex_get_output_underruns(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audioDuplexSetCounterResult(the, audio, audio->outputUnderruns);
	xSemaphoreGive(audio->mutex);
}

void xs_audio_duplex_get_output_buffered_bytes(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	uint32_t bytes;
	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	bytes = audio->outputRing.used;
	xSemaphoreGive(audio->mutex);
	xsmcSetInteger(xsResult, bytes);
}

static void audioDuplexSetNumberProperty(
	xsMachine *the,
	xsSlot object,
	xsIdentifier identifier,
	xsNumberValue value
)
{
	xsmcSetNumber(xsVar(0), value);
	xsmcSet(object, identifier, xsVar(0));
}

void xs_audio_duplex_get_aec_stats(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	uint8_t enabled;
	uint8_t internalMemory;
	uint8_t xsCore;
	uint8_t realtimeCore;
	uint16_t frameSamples;
	uint16_t referenceDelaySamples;
	uint16_t microphonePeak;
	uint16_t referencePeak;
	uint16_t outputPeak;
	uint32_t microphoneQueuedSamples;
	uint32_t referenceQueuedSamples;
	uint32_t diagnosticSamples;
	uint32_t diagnosticCapacitySamples;
	uint32_t internalFreeBytes;
	uint64_t exactReferenceFrames;
	uint64_t processedFrames;
	uint64_t processCalls;
	uint64_t microphoneOverruns;
	uint64_t referenceOverruns;
	uint64_t syncResets;
	uint64_t diagnosticDroppedSamples;
	uint64_t lastProcessUs;
	uint64_t maximumProcessUs;
	uint64_t totalProcessUs;
	uint64_t lastCycleUs;
	uint64_t maximumCycleUs;
	uint64_t totalCycleUs;
	double microphoneMeanSquare;
	double referenceMeanSquare;
	double outputMeanSquare;
	double erleDb;

	xsmcVars(1);
	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	enabled = audio->aecEnabled;
	internalMemory = stackchanAudioAecUsesInternalMemory(audio->aec);
	xsCore = audio->xsCore;
	realtimeCore = audio->realtimeCore;
	frameSamples = audio->aecFrameSamples;
	referenceDelaySamples = audio->aecReferenceDelaySamples;
	microphonePeak = audio->aecMicrophonePeak;
	referencePeak = audio->aecReferencePeak;
	outputPeak = audio->aecOutputPeak;
	microphoneQueuedSamples = audio->aecMicrophoneRing.used / sizeof(int16_t);
	referenceQueuedSamples = audio->aecReferenceRing.used / sizeof(int16_t);
	diagnosticSamples = audio->aecDiagnosticSamples;
	diagnosticCapacitySamples = audio->aecDiagnosticCapacitySamples;
	internalFreeBytes = stackchanAudioAecGetInternalFreeBytes(audio->aec);
	exactReferenceFrames = audio->exactReferenceFrames;
	processedFrames = audio->aecProcessedFrames;
	processCalls = audio->aecProcessCalls;
	microphoneOverruns = audio->aecMicrophoneOverruns;
	referenceOverruns = audio->aecReferenceOverruns;
	syncResets = audio->aecSyncResets;
	diagnosticDroppedSamples = audio->aecDiagnosticDroppedSamples;
	lastProcessUs = audio->aecLastProcessUs;
	maximumProcessUs = audio->aecMaximumProcessUs;
	totalProcessUs = audio->aecTotalProcessUs;
	lastCycleUs = audio->aecLastCycleUs;
	maximumCycleUs = audio->aecMaximumCycleUs;
	totalCycleUs = audio->aecTotalCycleUs;
	microphoneMeanSquare = audio->aecMicrophoneMeanSquare;
	referenceMeanSquare = audio->aecReferenceMeanSquare;
	outputMeanSquare = audio->aecOutputMeanSquare;
	xSemaphoreGive(audio->mutex);

	erleDb = 10.0 * log10(
		(microphoneMeanSquare + 1.0) / (outputMeanSquare + 1.0)
	);

	xsmcSetNewObject(xsResult);
	xsmcSetBoolean(xsVar(0), enabled);
	xsmcSet(xsResult, xsID("enabled"), xsVar(0));
	xsmcSetBoolean(xsVar(0), internalMemory);
	xsmcSet(xsResult, xsID("internalMemory"), xsVar(0));
	audioDuplexSetNumberProperty(the, xsResult, xsID("internalFreeBytes"), internalFreeBytes);
	audioDuplexSetNumberProperty(the, xsResult, xsID("xsCore"), xsCore);
	audioDuplexSetNumberProperty(the, xsResult, xsID("realtimeCore"), realtimeCore);
	audioDuplexSetNumberProperty(the, xsResult, xsID("frameSamples"), frameSamples);
	audioDuplexSetNumberProperty(the, xsResult, xsID("referenceDelaySamples"), referenceDelaySamples);
	audioDuplexSetNumberProperty(the, xsResult, xsID("exactReferenceFrames"), exactReferenceFrames);
	audioDuplexSetNumberProperty(the, xsResult, xsID("processedFrames"), processedFrames);
	audioDuplexSetNumberProperty(the, xsResult, xsID("processCalls"), processCalls);
	audioDuplexSetNumberProperty(the, xsResult, xsID("microphoneOverruns"), microphoneOverruns);
	audioDuplexSetNumberProperty(the, xsResult, xsID("referenceOverruns"), referenceOverruns);
	audioDuplexSetNumberProperty(the, xsResult, xsID("syncResets"), syncResets);
	audioDuplexSetNumberProperty(the, xsResult, xsID("lastProcessUs"), lastProcessUs);
	audioDuplexSetNumberProperty(the, xsResult, xsID("maximumProcessUs"), maximumProcessUs);
	audioDuplexSetNumberProperty(
		the,
		xsResult,
		xsID("averageProcessUs"),
		processCalls ? ((double)totalProcessUs / processCalls) : 0
	);
	audioDuplexSetNumberProperty(the, xsResult, xsID("lastCycleUs"), lastCycleUs);
	audioDuplexSetNumberProperty(the, xsResult, xsID("maximumCycleUs"), maximumCycleUs);
	audioDuplexSetNumberProperty(
		the,
		xsResult,
		xsID("averageCycleUs"),
		processCalls ? ((double)totalCycleUs / processCalls) : 0
	);
	audioDuplexSetNumberProperty(the, xsResult, xsID("microphoneRms"), sqrt(microphoneMeanSquare));
	audioDuplexSetNumberProperty(the, xsResult, xsID("referenceRms"), sqrt(referenceMeanSquare));
	audioDuplexSetNumberProperty(the, xsResult, xsID("outputRms"), sqrt(outputMeanSquare));
	audioDuplexSetNumberProperty(the, xsResult, xsID("erleDb"), erleDb);
	audioDuplexSetNumberProperty(the, xsResult, xsID("microphonePeak"), microphonePeak);
	audioDuplexSetNumberProperty(the, xsResult, xsID("referencePeak"), referencePeak);
	audioDuplexSetNumberProperty(the, xsResult, xsID("outputPeak"), outputPeak);
	audioDuplexSetNumberProperty(
		the,
		xsResult,
		xsID("microphoneQueuedSamples"),
		microphoneQueuedSamples
	);
	audioDuplexSetNumberProperty(
		the,
		xsResult,
		xsID("referenceQueuedSamples"),
		referenceQueuedSamples
	);
	audioDuplexSetNumberProperty(the, xsResult, xsID("diagnosticSamples"), diagnosticSamples);
	audioDuplexSetNumberProperty(
		the,
		xsResult,
		xsID("diagnosticCapacitySamples"),
		diagnosticCapacitySamples
	);
	audioDuplexSetNumberProperty(
		the,
		xsResult,
		xsID("diagnosticDroppedSamples"),
		diagnosticDroppedSamples
	);
}

void xs_audio_duplex_read_aec_diagnostics(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);
	uint8_t *buffer;
	uint32_t samples;
	uint32_t firstSamples;
	uint32_t bytes;
	int32_t maximumSamples = 0;

	if (xsmcArgc > 0) {
		maximumSamples = xsmcToInteger(xsArg(0));
		if (maximumSamples <= 0)
			xsRangeError("AEC diagnostic read size must be positive");
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	samples = audio->aecDiagnosticSamples;
	if (maximumSamples && (samples > (uint32_t)maximumSamples))
		samples = (uint32_t)maximumSamples;
	xSemaphoreGive(audio->mutex);
	if (!samples) {
		return;
	}

	bytes = samples * 3 * sizeof(int16_t);
	buffer = xsmcSetArrayBuffer(xsResult, C_NULL, bytes);

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	firstSamples = audio->aecDiagnosticCapacitySamples - audio->aecDiagnosticReadOffset;
	if (firstSamples > samples)
		firstSamples = samples;
	c_memcpy(
		buffer,
		audio->aecDiagnosticData + (audio->aecDiagnosticReadOffset * 3),
		firstSamples * 3 * sizeof(int16_t)
	);
	if (samples > firstSamples)
		c_memcpy(
			buffer + (firstSamples * 3 * sizeof(int16_t)),
			audio->aecDiagnosticData,
			(samples - firstSamples) * 3 * sizeof(int16_t)
		);
	audio->aecDiagnosticReadOffset =
		(audio->aecDiagnosticReadOffset + samples) %
		audio->aecDiagnosticCapacitySamples;
	audio->aecDiagnosticSamples -= samples;
	if (!audio->aecDiagnosticSamples)
		audio->aecDiagnosticReadOffset = 0;
	xSemaphoreGive(audio->mutex);
}

void xs_audio_duplex_clear_aec_diagnostics(xsMachine *the)
{
	AudioDuplex audio = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioDuplexHooks);

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->aecDiagnosticSamples = 0;
	audio->aecDiagnosticReadOffset = 0;
	audio->aecDiagnosticDroppedSamples = 0;
	xSemaphoreGive(audio->mutex);
}

static void audioDuplexDeliverInput(void *the, void *refcon, uint8_t *message, uint16_t messageLength)
{
	AudioDuplex audio = (AudioDuplex)refcon;
	uint32_t bytes;
	uint32_t frameBytes;
	(void)the;
	(void)message;
	(void)messageLength;

	if (kAudioDuplexStateTerminated == audio->state) {
		audio->inputCallbackPending = 0;
		audioDuplexMaybeFree(audio);
		return;
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	bytes = audio->inputStarted ? audio->inputRing.used : 0;
	frameBytes = audio->inputChannels * sizeof(int16_t);
	if (!audio->aecEnabled && (bytes > (AUDIO_DUPLEX_DMA_FRAMES * frameBytes)))
		bytes = AUDIO_DUPLEX_DMA_FRAMES * frameBytes;
	bytes -= bytes % frameBytes;
	xSemaphoreGive(audio->mutex);

	xsBeginHost(audio->the);
	if (bytes && audio->onReadable) {
		xsResult = xsAccess(audio->object);
		xsCallFunction2(xsReference(audio->onReadable), xsResult,
			xsInteger(bytes), xsInteger(bytes / frameBytes));
	}
	xsEndHost(audio->the);

	/* The callback may close the duplex object. In that case release() has
	 * already deleted the mutex and rings, but keeps this record alive until
	 * all posted callbacks retire. */
	if (kAudioDuplexStateActive != audio->state) {
		audio->inputCallbackPending = 0;
		if (kAudioDuplexStateTerminated == audio->state)
			audioDuplexMaybeFree(audio);
		return;
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->inputCallbackPending = 0;
	xSemaphoreGive(audio->mutex);
	audioDuplexPostInput(audio);
}

static void audioDuplexDeliverOutput(void *the, void *refcon, uint8_t *message, uint16_t messageLength)
{
	AudioDuplex audio = (AudioDuplex)refcon;
	uint32_t bytes;
	uint32_t frameBytes;
	(void)the;
	(void)message;
	(void)messageLength;

	if (kAudioDuplexStateTerminated == audio->state) {
		audio->outputCallbackPending = 0;
		audioDuplexMaybeFree(audio);
		return;
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	bytes = audio->outputStarted ? audioDuplexRingFree(&audio->outputRing) : 0;
	frameBytes = audio->outputChannels * sizeof(int16_t);
	if (!audio->aecEnabled && (bytes > (AUDIO_DUPLEX_DMA_FRAMES * frameBytes)))
		bytes = AUDIO_DUPLEX_DMA_FRAMES * frameBytes;
	bytes -= bytes % frameBytes;
	xSemaphoreGive(audio->mutex);

	xsBeginHost(audio->the);
	if (bytes && audio->onWritable) {
		xsResult = xsAccess(audio->object);
		xsCallFunction2(xsReference(audio->onWritable), xsResult,
			xsInteger(bytes), xsInteger(bytes / frameBytes));
	}
	xsEndHost(audio->the);

	/* See audioDuplexDeliverInput(): user code may close the shared owner. */
	if (kAudioDuplexStateActive != audio->state) {
		audio->outputCallbackPending = 0;
		if (kAudioDuplexStateTerminated == audio->state)
			audioDuplexMaybeFree(audio);
		return;
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->outputCallbackPending = 0;
	xSemaphoreGive(audio->mutex);
}

static void audioDuplexInputTask(void *refcon)
{
	AudioDuplex audio = (AudioDuplex)refcon;
	int16_t physical[AUDIO_DUPLEX_DMA_FRAMES * 2];
	int16_t logical[AUDIO_DUPLEX_DMA_FRAMES * 2];

	while (kAudioDuplexStateActive == audio->state) {
		size_t bytesRead = 0;
		esp_err_t err;
		uint32_t frames;
		uint32_t logicalBytes;
		uint32_t frameBytes;
		uint32_t i;
		uint8_t started;

		if (!audio->busStarted) {
			ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
			continue;
		}

		err = i2s_channel_read(audio->rxHandle, physical, sizeof(physical),
			&bytesRead, AUDIO_DUPLEX_IO_TIMEOUT_MS);
		if ((ESP_OK != err) || !bytesRead)
			continue;

		frames = bytesRead / (2 * sizeof(int16_t));
		if (!frames)
			continue;

		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		started = audio->inputStarted;
		xSemaphoreGive(audio->mutex);
		if (!started)
			continue;

		if (1 == audio->inputChannels) {
			for (i = 0; i < frames; i++)
				logical[i] = physical[i * 2];
		}
		else
			c_memcpy(logical, physical, frames * 2 * sizeof(int16_t));

		frameBytes = audio->inputChannels * sizeof(int16_t);
		logicalBytes = frames * frameBytes;

		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		if (audio->aecEnabled) {
			audioDuplexAecQueueMicrophoneLocked(audio, logical, frames);
			/* Keep the task handle alive until the non-blocking notify returns. */
			if (audio->aecTask)
				xTaskNotifyGive(audio->aecTask);
		}
		else {
			if (audioDuplexRingFree(&audio->inputRing) < logicalBytes) {
				uint32_t discard = logicalBytes - audioDuplexRingFree(&audio->inputRing);
				discard += frameBytes - 1;
				discard -= discard % frameBytes;
				audioDuplexRingDiscard(&audio->inputRing, discard);
				audio->inputOverruns += 1;
			}
			audioDuplexRingWrite(&audio->inputRing, (uint8_t *)logical, logicalBytes);
		}
		audio->capturedFrames += frames;
		xSemaphoreGive(audio->mutex);

		if (!audio->aecEnabled)
			audioDuplexPostInput(audio);
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->rxTask = C_NULL;
	xSemaphoreGive(audio->mutex);
	vTaskDelete(C_NULL);
}

static void audioDuplexOutputTask(void *refcon)
{
	AudioDuplex audio = (AudioDuplex)refcon;
	int16_t logical[AUDIO_DUPLEX_DMA_FRAMES * 2];
	int16_t physical[AUDIO_DUPLEX_DMA_FRAMES * 2];

	while (kAudioDuplexStateActive == audio->state) {
		size_t bytesWritten = 0;
		esp_err_t err;
		uint32_t requestedBytes;
		uint32_t logicalBytes = 0;
		uint32_t logicalFrames;
		uint32_t writtenFrames;
		uint32_t i;
		uint8_t started;
		uint8_t inputStarted;
		uint8_t notifyAec = 0;
		int16_t volume;

		if (!audio->busStarted) {
			ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
			continue;
		}

		requestedBytes = AUDIO_DUPLEX_DMA_FRAMES * audio->outputChannels * sizeof(int16_t);
		c_memset(logical, 0, sizeof(logical));
		c_memset(physical, 0, sizeof(physical));

		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		started = audio->outputStarted;
		volume = audio->volumeFixed;
		if (started)
			logicalBytes = audioDuplexRingRead(&audio->outputRing, (uint8_t *)logical, requestedBytes);
		if (started && (logicalBytes < requestedBytes))
			audio->outputUnderruns += 1;
		xSemaphoreGive(audio->mutex);

		logicalFrames = logicalBytes / (audio->outputChannels * sizeof(int16_t));
		if (1 == audio->outputChannels) {
			for (i = 0; i < logicalFrames; i++) {
				physical[i * 2] = audioDuplexScaleSample(logical[i], volume);
				physical[(i * 2) + 1] = 0;
			}
		}
		else {
			for (i = 0; i < (logicalFrames * 2); i++)
				physical[i] = audioDuplexScaleSample(logical[i], volume);
		}

		err = i2s_channel_write(audio->txHandle, physical, sizeof(physical),
			&bytesWritten, AUDIO_DUPLEX_IO_TIMEOUT_MS);
		writtenFrames = bytesWritten / (2 * sizeof(int16_t));
		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		inputStarted = audio->inputStarted;
		if ((ESP_OK == err) && writtenFrames) {
			uint32_t renderedFrames = logicalFrames;
			if (renderedFrames > writtenFrames)
				renderedFrames = writtenFrames;
			if (started)
				audio->renderedFrames += renderedFrames;
			if (audio->aecEnabled && inputStarted) {
				audioDuplexAecQueueReferenceLocked(audio, physical, writtenFrames);
				notifyAec = 1;
			}
		}
		else if (audio->aecEnabled && inputStarted) {
			audioDuplexAecResetLocked(audio);
			notifyAec = 1;
		}
		if (notifyAec && audio->aecTask)
			xTaskNotifyGive(audio->aecTask);
		xSemaphoreGive(audio->mutex);

		if ((ESP_OK == err) && started)
			audioDuplexPostOutput(audio);
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->txTask = C_NULL;
	xSemaphoreGive(audio->mutex);
	vTaskDelete(C_NULL);
}

static void audioDuplexAecTask(void *refcon)
{
	AudioDuplex audio = (AudioDuplex)refcon;
	int16_t microphone[AUDIO_DUPLEX_AEC_FRAME_SAMPLES];
	int16_t reference[AUDIO_DUPLEX_AEC_FRAME_SAMPLES];
	int16_t output[AUDIO_DUPLEX_AEC_FRAME_SAMPLES];
	const uint32_t frameBytes = AUDIO_DUPLEX_AEC_FRAME_SAMPLES * sizeof(int16_t);

	while (kAudioDuplexStateActive == audio->state) {
		uint8_t haveFrame = 0;
		uint8_t postInput = 0;
		uint32_t epoch = 0;
		uint64_t microphoneEnergy = 0;
		uint64_t referenceEnergy = 0;
		uint64_t outputEnergy = 0;
		uint64_t elapsedUs;
		uint64_t cycleElapsedUs;
		uint16_t microphonePeak = 0;
		uint16_t referencePeak = 0;
		uint16_t outputPeak = 0;
		uint8_t collectStats;
		int64_t startedUs;
		uint32_t sample;

		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		if (audio->inputStarted &&
			(audio->aecMicrophoneRing.used >= frameBytes) &&
			(audio->aecReferenceRing.used >= frameBytes)) {
			audioDuplexRingRead(
				&audio->aecMicrophoneRing,
				(uint8_t *)microphone,
				frameBytes
			);
			audioDuplexRingRead(
				&audio->aecReferenceRing,
				(uint8_t *)reference,
				frameBytes
			);
			epoch = audio->aecEpoch;
			haveFrame = 1;
		}
		xSemaphoreGive(audio->mutex);

		if (!haveFrame) {
			ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
			continue;
		}

		startedUs = esp_timer_get_time();
		stackchanAudioAecProcess(audio->aec, microphone, reference, output);
		elapsedUs = esp_timer_get_time() - startedUs;

		collectStats =
			(0 == (audio->aecProcessCalls % AUDIO_DUPLEX_AEC_STATS_INTERVAL_CALLS));
		if (collectStats) {
			for (sample = 0; sample < AUDIO_DUPLEX_AEC_FRAME_SAMPLES; sample++) {
				int32_t mic = microphone[sample];
				int32_t ref = reference[sample];
				int32_t clean = output[sample];
				uint16_t magnitude;

				microphoneEnergy += (int64_t)mic * mic;
				referenceEnergy += (int64_t)ref * ref;
				outputEnergy += (int64_t)clean * clean;
				magnitude = audioDuplexSampleMagnitude(microphone[sample]);
				if (microphonePeak < magnitude)
					microphonePeak = magnitude;
				magnitude = audioDuplexSampleMagnitude(reference[sample]);
				if (referencePeak < magnitude)
					referencePeak = magnitude;
				magnitude = audioDuplexSampleMagnitude(output[sample]);
				if (outputPeak < magnitude)
					outputPeak = magnitude;
			}
		}

		xSemaphoreTake(audio->mutex, portMAX_DELAY);
		audio->aecLastProcessUs = elapsedUs;
		audio->aecTotalProcessUs += elapsedUs;
		if (audio->aecMaximumProcessUs < elapsedUs)
			audio->aecMaximumProcessUs = elapsedUs;
		audio->aecProcessCalls += 1;

		if ((kAudioDuplexStateActive == audio->state) &&
			audio->inputStarted && (epoch == audio->aecEpoch)) {
			if (collectStats) {
				double microphoneMeanSquare =
					(double)microphoneEnergy / AUDIO_DUPLEX_AEC_FRAME_SAMPLES;
				double referenceMeanSquare =
					(double)referenceEnergy / AUDIO_DUPLEX_AEC_FRAME_SAMPLES;
				double outputMeanSquare =
					(double)outputEnergy / AUDIO_DUPLEX_AEC_FRAME_SAMPLES;

				if (!audio->aecProcessedFrames) {
					audio->aecMicrophoneMeanSquare = microphoneMeanSquare;
					audio->aecReferenceMeanSquare = referenceMeanSquare;
					audio->aecOutputMeanSquare = outputMeanSquare;
				}
				else {
					audio->aecMicrophoneMeanSquare =
						(audio->aecMicrophoneMeanSquare * 0.9) + (microphoneMeanSquare * 0.1);
					audio->aecReferenceMeanSquare =
						(audio->aecReferenceMeanSquare * 0.9) + (referenceMeanSquare * 0.1);
					audio->aecOutputMeanSquare =
						(audio->aecOutputMeanSquare * 0.9) + (outputMeanSquare * 0.1);
				}
				audio->aecMicrophonePeak = microphonePeak;
				audio->aecReferencePeak = referencePeak;
				audio->aecOutputPeak = outputPeak;
			}
			audio->aecProcessedFrames += AUDIO_DUPLEX_AEC_FRAME_SAMPLES;

			if (audio->aecDiagnosticData) {
				uint32_t available =
					audio->aecDiagnosticCapacitySamples - audio->aecDiagnosticSamples;
				uint32_t captureSamples = AUDIO_DUPLEX_AEC_FRAME_SAMPLES;
				uint32_t writeOffset =
					(audio->aecDiagnosticReadOffset + audio->aecDiagnosticSamples) %
					audio->aecDiagnosticCapacitySamples;

				if (captureSamples > available)
					captureSamples = available;
				for (sample = 0; sample < captureSamples; sample++) {
					uint32_t destinationOffset = writeOffset + sample;
					int16_t *destination;

					if (destinationOffset >= audio->aecDiagnosticCapacitySamples)
						destinationOffset -= audio->aecDiagnosticCapacitySamples;
					destination = audio->aecDiagnosticData + (destinationOffset * 3);
					*destination++ = microphone[sample];
					*destination++ = reference[sample];
					*destination++ = output[sample];
				}
				audio->aecDiagnosticSamples += captureSamples;
				audio->aecDiagnosticDroppedSamples +=
					AUDIO_DUPLEX_AEC_FRAME_SAMPLES - captureSamples;
			}

			if (audioDuplexRingFree(&audio->inputRing) < frameBytes) {
				uint32_t discard = frameBytes - audioDuplexRingFree(&audio->inputRing);
				discard += sizeof(int16_t) - 1;
				discard -= discard % sizeof(int16_t);
				audioDuplexRingDiscard(&audio->inputRing, discard);
				audio->inputOverruns += 1;
			}
			audioDuplexRingWrite(&audio->inputRing, (uint8_t *)output, frameBytes);
			postInput = 1;
		}
		cycleElapsedUs = esp_timer_get_time() - startedUs;
		audio->aecLastCycleUs = cycleElapsedUs;
		audio->aecTotalCycleUs += cycleElapsedUs;
		if (audio->aecMaximumCycleUs < cycleElapsedUs)
			audio->aecMaximumCycleUs = cycleElapsedUs;
		xSemaphoreGive(audio->mutex);

		if (postInput)
			audioDuplexPostInput(audio);
	}

	xSemaphoreTake(audio->mutex, portMAX_DELAY);
	audio->aecTask = C_NULL;
	xSemaphoreGive(audio->mutex);
	vTaskDelete(C_NULL);
}
