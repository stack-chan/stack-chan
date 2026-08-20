/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

#include "xsHost.h"
#include "xsmc.h"
#include "mc.xs.h"

#include "esp_heap_caps.h"
#include "esp_memory_utils.h"
#include "esp_opus_enc.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#define OPUS_ENCODER_STACK_BYTES (24 * 1024)
#define OPUS_MAX_INPUT_BYTES 1920
#define OPUS_MAX_PACKET_BYTES 1275
#define PCM_FRAME_BYTES 1920
#define PACKET_RING_DEPTH 16
#define PCM_RING_READ 0
#define PCM_RING_WRITE 1
#define PCM_RING_CAPTURED 2
#define PCM_RING_DROPPED_BYTES 3
#define PCM_RING_STATE_WORDS 4

typedef struct {
	uint8_t *data;
	uint32_t *state;
	uint32_t length;
} xsPcmRing;

typedef struct {
	esp_audio_err_t result;
	uint32_t bytes;
	uint32_t generation;
	int64_t elapsed;
	uint8_t data[OPUS_MAX_PACKET_BYTES];
} xsESP32OpusPacket;

typedef struct {
	void *handle;
	uint32_t inputBytes;
	uint32_t outputBytes;
	uint32_t generation;
	uint32_t stop;
	xsPcmRing pcm;
	xsESP32OpusPacket *packets;
	uint32_t packetRead;
	uint32_t packetWrite;
	SemaphoreHandle_t packetSpace;
	SemaphoreHandle_t packetAvail;
	SemaphoreHandle_t pcmGate;
	SemaphoreHandle_t stopped;
	TaskHandle_t task;
} xsESP32OpusEncoderRecord;

static uint32_t pcmRingReadable(const xsPcmRing *ring)
{
	uint32_t read = __atomic_load_n(&ring->state[PCM_RING_READ], __ATOMIC_ACQUIRE);
	uint32_t write = __atomic_load_n(&ring->state[PCM_RING_WRITE], __ATOMIC_ACQUIRE);
	return write >= read ? write - read : ring->length - read + write;
}

static uint32_t pcmRingWritable(const xsPcmRing *ring)
{
	return ring->length - pcmRingReadable(ring) - sizeof(int16_t);
}

static void pcmRingReset(xsPcmRing *ring)
{
	__atomic_store_n(&ring->state[PCM_RING_READ], 0, __ATOMIC_RELEASE);
	__atomic_store_n(&ring->state[PCM_RING_WRITE], 0, __ATOMIC_RELEASE);
	__atomic_store_n(&ring->state[PCM_RING_CAPTURED], 0, __ATOMIC_RELAXED);
	__atomic_store_n(&ring->state[PCM_RING_DROPPED_BYTES], 0, __ATOMIC_RELAXED);
}

static void pcmRingEmpty(xsPcmRing *ring)
{
	uint32_t write = __atomic_load_n(&ring->state[PCM_RING_WRITE], __ATOMIC_ACQUIRE);
	__atomic_store_n(&ring->state[PCM_RING_READ], write, __ATOMIC_RELEASE);
}

static void pcmRingCopyIn(xsPcmRing *ring, const uint8_t *src, uint32_t bytes)
{
	uint32_t write = __atomic_load_n(&ring->state[PCM_RING_WRITE], __ATOMIC_RELAXED);
	uint32_t first = ring->length - write;
	if (first > bytes)
		first = bytes;
	c_memcpy(ring->data + write, src, first);
	if (first < bytes)
		c_memcpy(ring->data, src + first, bytes - first);
	__atomic_store_n(&ring->state[PCM_RING_WRITE], (write + bytes) % ring->length, __ATOMIC_RELEASE);
}

static void pcmRingCopyOut(xsPcmRing *ring, uint8_t *dst, uint32_t bytes)
{
	uint32_t read = __atomic_load_n(&ring->state[PCM_RING_READ], __ATOMIC_RELAXED);
	uint32_t first = ring->length - read;
	if (first > bytes)
		first = bytes;
	c_memcpy(dst, ring->data + read, first);
	if (first < bytes)
		c_memcpy(dst + first, ring->data, bytes - first);
	__atomic_store_n(&ring->state[PCM_RING_READ], (read + bytes) % ring->length, __ATOMIC_RELEASE);
}

static uint32_t pcmRingWriteDownmix(xsPcmRing *ring, const uint8_t *src, uint32_t size, int channels)
{
	uint8_t mono[PCM_FRAME_BYTES];
	uint32_t written = 0;
	const int16_t *input = (const int16_t *)src;
	uint32_t srcSamples;
	uint32_t srcIndex = 0;
	uint32_t outputBytes;

	if (!ring->data || !ring->state || ring->length < (PCM_FRAME_BYTES + sizeof(int16_t)) || !size)
		return 0;
	outputBytes = size / (uint32_t)channels;
	__atomic_add_fetch(&ring->state[PCM_RING_CAPTURED], outputBytes, __ATOMIC_RELAXED);
	if (pcmRingWritable(ring) < outputBytes) {
		__atomic_add_fetch(&ring->state[PCM_RING_DROPPED_BYTES], outputBytes, __ATOMIC_RELAXED);
		return 0;
	}
	srcSamples = size / 2;

	while (srcIndex < srcSamples) {
		uint32_t remain = srcSamples - srcIndex;
		uint32_t chunkSamples = channels == 2 ? remain / 2 : remain;
		uint32_t chunkBytes;
		if (chunkSamples * 2 > sizeof(mono))
			chunkSamples = sizeof(mono) / 2;
		if (!chunkSamples)
			break;
		chunkBytes = chunkSamples * 2;
		if (channels == 2) {
			int16_t *output = (int16_t *)mono;
			uint32_t i;
			for (i = 0; i < chunkSamples; i++)
				output[i] = input[srcIndex + (i * 2)];
			srcIndex += chunkSamples * 2;
		} else {
			c_memcpy(mono, input + srcIndex, chunkBytes);
			srcIndex += chunkSamples;
		}
		pcmRingCopyIn(ring, mono, chunkBytes);
		written += chunkBytes;
	}
	return written;
}

static void opusEncoderTask(void *parameter)
{
	xsESP32OpusEncoderRecord *encoder = parameter;
	uint8_t input[OPUS_MAX_INPUT_BYTES];
	xsESP32OpusPacket output;

	for (;;) {
		uint32_t generation;
		esp_audio_enc_in_frame_t inFrame = {0};
		esp_audio_enc_out_frame_t outFrame = {0};
		int64_t startedAt;
		uint8_t haveFrame = 0;

		if (__atomic_load_n(&encoder->stop, __ATOMIC_ACQUIRE))
			break;

		if (pdTRUE != xSemaphoreTake(encoder->pcmGate, pdMS_TO_TICKS(10))) {
			if (__atomic_load_n(&encoder->stop, __ATOMIC_ACQUIRE))
				break;
			continue;
		}
		if (__atomic_load_n(&encoder->stop, __ATOMIC_ACQUIRE)) {
			xSemaphoreGive(encoder->pcmGate);
			break;
		}
		generation = __atomic_load_n(&encoder->generation, __ATOMIC_ACQUIRE);
		if (encoder->pcm.data && encoder->pcm.state &&
			pcmRingReadable(&encoder->pcm) >= encoder->inputBytes) {
			pcmRingCopyOut(&encoder->pcm, input, encoder->inputBytes);
			haveFrame = 1;
		}
		xSemaphoreGive(encoder->pcmGate);

		if (!haveFrame) {
			vTaskDelay(pdMS_TO_TICKS(20));
			continue;
		}

		inFrame.buffer = input;
		inFrame.len = encoder->inputBytes;
		outFrame.buffer = output.data;
		outFrame.len = sizeof(output.data);
		startedAt = esp_timer_get_time();
		output.result = esp_opus_enc_process(encoder->handle, &inFrame, &outFrame);
		output.elapsed = esp_timer_get_time() - startedAt;
		output.bytes = outFrame.encoded_bytes;
		output.generation = generation;
		if (output.generation != __atomic_load_n(&encoder->generation, __ATOMIC_SEQ_CST))
			continue;

		while (!__atomic_load_n(&encoder->stop, __ATOMIC_ACQUIRE)) {
			if (pdTRUE == xSemaphoreTake(encoder->packetSpace, pdMS_TO_TICKS(10))) {
				encoder->packets[encoder->packetWrite] = output;
				encoder->packetWrite = (encoder->packetWrite + 1) % PACKET_RING_DEPTH;
				xSemaphoreGive(encoder->packetAvail);
				break;
			}
		}
	}
	xSemaphoreGive(encoder->stopped);
	vTaskDelete(NULL);
}

static void drainPackets(xsESP32OpusEncoderRecord *encoder)
{
	while (pdTRUE == xSemaphoreTake(encoder->packetAvail, 0)) {
		encoder->packetRead = (encoder->packetRead + 1) % PACKET_RING_DEPTH;
		xSemaphoreGive(encoder->packetSpace);
	}
}

void xs_esp32_opus_encoder_destructor(void *data)
{
	xsESP32OpusEncoderRecord *encoder = data;

	if (!encoder)
		return;
	__atomic_store_n(&encoder->stop, 1, __ATOMIC_RELEASE);
	if (encoder->task) {
		xSemaphoreTake(encoder->stopped, portMAX_DELAY);
		encoder->task = NULL;
	}
	if (encoder->packetSpace)
		vSemaphoreDelete(encoder->packetSpace);
	if (encoder->packetAvail)
		vSemaphoreDelete(encoder->packetAvail);
	if (encoder->pcmGate)
		vSemaphoreDelete(encoder->pcmGate);
	if (encoder->stopped)
		vSemaphoreDelete(encoder->stopped);
	if (encoder->packets)
		heap_caps_free(encoder->packets);
	if (encoder->handle)
		esp_opus_enc_close(encoder->handle);
	c_free(encoder);
}

void xs_esp32_opus_encoder_constructor(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = c_calloc(1, sizeof(xsESP32OpusEncoderRecord));
	esp_opus_enc_config_t config = {
		.sample_rate = ESP_AUDIO_SAMPLE_RATE_16K,
		.channel = ESP_AUDIO_MONO,
		.bits_per_sample = ESP_AUDIO_BIT16,
		.bitrate = ESP_OPUS_BITRATE_AUTO,
		.frame_duration = ESP_OPUS_ENC_FRAME_DURATION_60_MS,
		.application_mode = ESP_OPUS_ENC_APPLICATION_AUDIO,
		.complexity = 0,
		.enable_fec = false,
		.enable_dtx = true,
		.enable_vbr = true,
	};
	uint32_t internalBefore;
	uint32_t psramBefore;
	uint32_t internalAfter;
	uint32_t psramAfter;
	esp_audio_err_t openResult;
	int inputBytes;
	int outputBytes;

	if (!encoder)
		xsUnknownError("no memory for Opus encoder");
	internalBefore = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	psramBefore = heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	openResult = esp_opus_enc_open(&config, sizeof(config), &encoder->handle);
	if (ESP_AUDIO_ERR_OK != openResult)
		goto failed;
	if (ESP_AUDIO_ERR_OK != esp_opus_enc_get_frame_size(encoder->handle, &inputBytes, &outputBytes))
		goto failed;
	if ((inputBytes <= 0) || (inputBytes > OPUS_MAX_INPUT_BYTES) || (outputBytes <= 0) ||
		(outputBytes > OPUS_MAX_PACKET_BYTES))
		goto failed;
	encoder->inputBytes = (uint32_t)inputBytes;
	encoder->outputBytes = OPUS_MAX_PACKET_BYTES;
	encoder->packets = heap_caps_calloc(PACKET_RING_DEPTH, sizeof(xsESP32OpusPacket),
		MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	encoder->packetSpace = xSemaphoreCreateCounting(PACKET_RING_DEPTH, PACKET_RING_DEPTH);
	encoder->packetAvail = xSemaphoreCreateCounting(PACKET_RING_DEPTH, 0);
	encoder->pcmGate = xSemaphoreCreateMutex();
	encoder->stopped = xSemaphoreCreateBinary();
	if (!encoder->packets || !encoder->packetSpace || !encoder->packetAvail || !encoder->pcmGate ||
		!encoder->stopped)
		goto failed;
	if (pdPASS != xTaskCreate(opusEncoderTask, "opus-encoder", OPUS_ENCODER_STACK_BYTES, encoder,
		tskIDLE_PRIORITY + 5, &encoder->task))
		goto failed;
	internalAfter = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	psramAfter = heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	xsmcSetHostData(xsThis, encoder);

	xsmcSetInteger(xsResult, encoder->inputBytes);
	xsmcSet(xsThis, xsID("inputBytes"), xsResult);
	xsmcSetInteger(xsResult, encoder->outputBytes);
	xsmcSet(xsThis, xsID("outputBytes"), xsResult);
	xsmcSetInteger(xsResult, internalBefore > internalAfter ? internalBefore - internalAfter : 0);
	xsmcSet(xsThis, xsID("internalHeapBytes"), xsResult);
	xsmcSetInteger(xsResult, psramBefore > psramAfter ? psramBefore - psramAfter : 0);
	xsmcSet(xsThis, xsID("psramHeapBytes"), xsResult);
	return;

failed:
	xs_esp32_opus_encoder_destructor(encoder);
	xsUnknownError("ESP Opus encoder initialization failed");
}

void xs_esp32_opus_encoder_close(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = xsmcGetHostData(xsThis);
	xs_esp32_opus_encoder_destructor(encoder);
	xsmcSetHostData(xsThis, NULL);
}

void xs_pcm_ring_write_downmix(xsMachine *the)
{
	xsPcmRing ring;
	uint8_t *data;
	uint32_t *state;
	uint8_t *src;
	xsUnsignedValue dataBytes;
	xsUnsignedValue stateBytes;
	xsUnsignedValue srcBytes;
	uint32_t offset;
	uint32_t size;
	int channels;
	uint32_t written;

	xsmcGetBufferWritable(xsArg(0), (void **)&data, &dataBytes);
	xsmcGetBufferWritable(xsArg(1), (void **)&state, &stateBytes);
	xsmcGetBufferReadable(xsArg(2), (void **)&src, &srcBytes);
	offset = xsmcToInteger(xsArg(3));
	size = xsmcToInteger(xsArg(4));
	channels = xsmcToInteger(xsArg(5));
	if (stateBytes < (PCM_RING_STATE_WORDS * sizeof(uint32_t)))
		xsRangeError("PCM ring state is too small");
	if ((uintptr_t)state & 3)
		xsRangeError("PCM ring state is not aligned");
	if ((dataBytes < (PCM_FRAME_BYTES + sizeof(int16_t))) || (dataBytes & 1))
		xsRangeError("PCM ring is too small");
	if ((offset > srcBytes) || (size > (srcBytes - offset)))
		xsRangeError("PCM source range out of bounds");
	if ((channels != 1) && (channels != 2))
		xsRangeError("PCM channels must be 1 or 2");
	if ((offset % (channels * sizeof(int16_t))) || (size % (channels * sizeof(int16_t))))
		xsRangeError("PCM source must contain whole samples");
	if ((uintptr_t)(src + offset) & 1)
		xsRangeError("PCM source is not aligned");
	if (!esp_ptr_external_ram(data))
		xsUnknownError("PCM ring must be in PSRAM");
	if (!esp_ptr_in_dram(state))
		xsUnknownError("PCM ring state must be in internal DRAM");
	ring.data = data;
	ring.state = state;
	ring.length = dataBytes;
	written = pcmRingWriteDownmix(&ring, src + offset, size, channels);
	xsmcSetInteger(xsResult, (xsIntegerValue)written);
}

void xs_esp32_opus_encoder_attach_pcm_ring(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = xsmcGetHostData(xsThis);
	uint8_t *data;
	uint32_t *state;
	xsUnsignedValue dataBytes;
	xsUnsignedValue stateBytes;

	if (!encoder)
		xsUnknownError("Opus encoder is closed");
	xsmcGetBufferWritable(xsArg(0), (void **)&data, &dataBytes);
	xsmcGetBufferWritable(xsArg(1), (void **)&state, &stateBytes);
	if (stateBytes < (PCM_RING_STATE_WORDS * sizeof(uint32_t)))
		xsRangeError("PCM ring state is too small");
	if ((uintptr_t)state & 3)
		xsRangeError("PCM ring state is not aligned");
	if ((dataBytes < (PCM_FRAME_BYTES + sizeof(int16_t))) || (dataBytes & 1))
		xsRangeError("PCM ring is too small");
	if (!esp_ptr_external_ram(data))
		xsUnknownError("PCM ring must be in PSRAM");
	if (!esp_ptr_in_dram(state))
		xsUnknownError("PCM ring state must be in internal DRAM");
	xSemaphoreTake(encoder->pcmGate, portMAX_DELAY);
	encoder->pcm.data = data;
	encoder->pcm.state = state;
	encoder->pcm.length = dataBytes;
	pcmRingReset(&encoder->pcm);
	xSemaphoreGive(encoder->pcmGate);
}

void xs_esp32_opus_encoder_read(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = xsmcGetHostData(xsThis);
	xsESP32OpusPacket packet;
	uint8_t *output;
	xsUnsignedValue outputBytes;

	if (!encoder)
		xsUnknownError("Opus encoder is closed");
	xsmcGetBufferWritable(xsArg(0), (void **)&output, &outputBytes);
	if (outputBytes < encoder->outputBytes)
		xsRangeError("Opus output buffer too small");
	do {
		if (pdTRUE != xSemaphoreTake(encoder->packetAvail, 0)) {
			xsmcSetInteger(xsResult, 0);
			return;
		}
		packet = encoder->packets[encoder->packetRead];
		encoder->packetRead = (encoder->packetRead + 1) % PACKET_RING_DEPTH;
		xSemaphoreGive(encoder->packetSpace);
	} while (packet.generation != __atomic_load_n(&encoder->generation, __ATOMIC_SEQ_CST));
	if (ESP_AUDIO_ERR_OK != packet.result)
		xsUnknownError("ESP Opus encode failed");
	if (!packet.bytes || (packet.bytes > outputBytes) || (packet.bytes > OPUS_MAX_PACKET_BYTES))
		xsUnknownError("ESP Opus encoder returned invalid packet");
	c_memcpy(output, packet.data, packet.bytes);
	xsmcSetInteger(xsResult, (xsIntegerValue)packet.elapsed);
	xsmcSet(xsThis, xsID("encodeUs"), xsResult);
	xsmcSetInteger(xsResult, packet.bytes);
}

void xs_esp32_opus_encoder_clear(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = xsmcGetHostData(xsThis);
	if (!encoder)
		return;
	__atomic_add_fetch(&encoder->generation, 1, __ATOMIC_SEQ_CST);
	drainPackets(encoder);
	xSemaphoreTake(encoder->pcmGate, portMAX_DELAY);
	if (encoder->pcm.state)
		pcmRingEmpty(&encoder->pcm);
	xSemaphoreGive(encoder->pcmGate);
}

static uint32_t pcmRingStat(xsESP32OpusEncoderRecord *encoder, int index)
{
	uint32_t value;
	if (!encoder || !encoder->pcmGate || !encoder->pcm.state)
		return 0;
	xSemaphoreTake(encoder->pcmGate, portMAX_DELAY);
	if (!encoder->pcm.state) {
		xSemaphoreGive(encoder->pcmGate);
		return 0;
	}
	value = __atomic_load_n(&encoder->pcm.state[index], __ATOMIC_RELAXED);
	xSemaphoreGive(encoder->pcmGate);
	return value;
}

void xs_esp32_opus_encoder_captured_pcm_bytes(xsMachine *the)
{
	xsmcSetInteger(xsResult, pcmRingStat(xsmcGetHostData(xsThis), PCM_RING_CAPTURED));
}

void xs_esp32_opus_encoder_dropped_pcm_bytes(xsMachine *the)
{
	xsmcSetInteger(xsResult, pcmRingStat(xsmcGetHostData(xsThis), PCM_RING_DROPPED_BYTES));
}
