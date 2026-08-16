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
#include "esp_opus_enc.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#define OPUS_ENCODER_STACK_BYTES (24 * 1024)
#define OPUS_MAX_INPUT_BYTES 1920
#define OPUS_MAX_PACKET_BYTES 1275
#define OPUS_QUEUE_DEPTH 2

typedef struct {
	uint32_t bytes;
	uint32_t generation;
	uint8_t data[OPUS_MAX_INPUT_BYTES];
} xsESP32OpusPCMFrame;

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
	QueueHandle_t inputQueue;
	QueueHandle_t outputQueue;
	SemaphoreHandle_t stopped;
	TaskHandle_t task;
} xsESP32OpusEncoderRecord;

static void queueLatest(QueueHandle_t queue, const void *item, void *discard)
{
	if (pdTRUE == xQueueSend(queue, item, 0))
		return;
	xQueueReceive(queue, discard, 0);
	xQueueSend(queue, item, 0);
}

static void opusEncoderTask(void *parameter)
{
	xsESP32OpusEncoderRecord *encoder = parameter;
	xsESP32OpusPCMFrame input;
	xsESP32OpusPacket output;
	xsESP32OpusPacket discard;

	for (;;) {
		esp_audio_enc_in_frame_t inFrame = {0};
		esp_audio_enc_out_frame_t outFrame = {0};
		int64_t startedAt;

		xQueueReceive(encoder->inputQueue, &input, portMAX_DELAY);
		if (!input.bytes)
			break;
		inFrame.buffer = input.data;
		inFrame.len = input.bytes;
		outFrame.buffer = output.data;
		outFrame.len = sizeof(output.data);
		startedAt = esp_timer_get_time();
		output.result = esp_opus_enc_process(encoder->handle, &inFrame, &outFrame);
		output.elapsed = esp_timer_get_time() - startedAt;
		output.bytes = outFrame.encoded_bytes;
		output.generation = input.generation;
		if (output.generation == __atomic_load_n(&encoder->generation, __ATOMIC_SEQ_CST))
			queueLatest(encoder->outputQueue, &output, &discard);
	}
	xSemaphoreGive(encoder->stopped);
	vTaskDelete(NULL);
}

void xs_esp32_opus_encoder_destructor(void *data)
{
	xsESP32OpusEncoderRecord *encoder = data;
	xsESP32OpusPCMFrame stop = {0};
	xsESP32OpusPCMFrame discard;

	if (!encoder)
		return;
	if (encoder->task) {
		queueLatest(encoder->inputQueue, &stop, &discard);
		xSemaphoreTake(encoder->stopped, portMAX_DELAY);
		encoder->task = NULL;
	}
	if (encoder->inputQueue)
		vQueueDelete(encoder->inputQueue);
	if (encoder->outputQueue)
		vQueueDelete(encoder->outputQueue);
	if (encoder->stopped)
		vSemaphoreDelete(encoder->stopped);
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
	encoder->inputBytes = inputBytes;
	encoder->outputBytes = OPUS_MAX_PACKET_BYTES;
	encoder->inputQueue = xQueueCreate(OPUS_QUEUE_DEPTH, sizeof(xsESP32OpusPCMFrame));
	encoder->outputQueue = xQueueCreate(OPUS_QUEUE_DEPTH, sizeof(xsESP32OpusPacket));
	encoder->stopped = xSemaphoreCreateBinary();
	if (!encoder->inputQueue || !encoder->outputQueue || !encoder->stopped)
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

void xs_esp32_opus_encoder_enqueue(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = xsmcGetHostData(xsThis);
	xsESP32OpusPCMFrame frame;
	xsESP32OpusPCMFrame discard;
	uint8_t *input;
	xsUnsignedValue inputBytes;
	BaseType_t queued;

	if (!encoder)
		xsUnknownError("Opus encoder is closed");
	xsmcGetBufferReadable(xsArg(0), (void **)&input, &inputBytes);
	if (inputBytes != encoder->inputBytes)
		xsRangeError("invalid Opus PCM frame size");
	frame.bytes = inputBytes;
	frame.generation = __atomic_load_n(&encoder->generation, __ATOMIC_SEQ_CST);
	c_memcpy(frame.data, input, inputBytes);
	queued = xQueueSend(encoder->inputQueue, &frame, 0);
	if (pdTRUE != queued) {
		xQueueReceive(encoder->inputQueue, &discard, 0);
		xQueueSend(encoder->inputQueue, &frame, 0);
	}
	xsmcSetBoolean(xsResult, pdTRUE == queued);
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
		if (pdTRUE != xQueueReceive(encoder->outputQueue, &packet, 0)) {
			xsmcSetInteger(xsResult, 0);
			return;
		}
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
	xQueueReset(encoder->inputQueue);
	xQueueReset(encoder->outputQueue);
}
