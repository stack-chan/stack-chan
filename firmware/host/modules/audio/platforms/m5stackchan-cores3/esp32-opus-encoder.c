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

typedef struct {
	void *handle;
	uint32_t inputBytes;
	uint32_t outputBytes;
} xsESP32OpusEncoderRecord;

void xs_esp32_opus_encoder_destructor(void *data)
{
	xsESP32OpusEncoderRecord *encoder = data;
	if (!encoder)
		return;
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
	int inputBytes;
	int outputBytes;

	if (!encoder)
		xsUnknownError("no memory for Opus encoder");
	internalBefore = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	psramBefore = heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (ESP_AUDIO_ERR_OK != esp_opus_enc_open(&config, sizeof(config), &encoder->handle)) {
		c_free(encoder);
		xsUnknownError("ESP Opus encoder open failed");
	}
	if (ESP_AUDIO_ERR_OK != esp_opus_enc_get_frame_size(encoder->handle, &inputBytes, &outputBytes)) {
		xs_esp32_opus_encoder_destructor(encoder);
		xsUnknownError("ESP Opus encoder frame size failed");
	}
	if ((inputBytes <= 0) || (outputBytes <= 0) || (outputBytes > 1275)) {
		xs_esp32_opus_encoder_destructor(encoder);
		xsUnknownError("ESP Opus encoder returned invalid frame size");
	}
	encoder->inputBytes = inputBytes;
	encoder->outputBytes = outputBytes;
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
}

void xs_esp32_opus_encoder_close(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = xsmcGetHostData(xsThis);
	xs_esp32_opus_encoder_destructor(encoder);
	xsmcSetHostData(xsThis, NULL);
}

void xs_esp32_opus_encode(xsMachine *the)
{
	xsESP32OpusEncoderRecord *encoder = xsmcGetHostData(xsThis);
	uint8_t *input;
	uint8_t *output;
	xsUnsignedValue inputBytes;
	xsUnsignedValue outputBytes;
	esp_audio_enc_in_frame_t inFrame = {0};
	esp_audio_enc_out_frame_t outFrame = {0};
	esp_audio_err_t result;
	int64_t startedAt;

	if (!encoder)
		xsUnknownError("Opus encoder is closed");
	xsmcGetBufferReadable(xsArg(0), (void **)&input, &inputBytes);
	xsmcGetBufferWritable(xsArg(1), (void **)&output, &outputBytes);
	if (inputBytes != encoder->inputBytes)
		xsRangeError("invalid Opus PCM frame size");
	if (outputBytes < encoder->outputBytes)
		xsRangeError("Opus output buffer too small");

	inFrame.buffer = input;
	inFrame.len = inputBytes;
	outFrame.buffer = output;
	outFrame.len = outputBytes;
	startedAt = esp_timer_get_time();
	result = esp_opus_enc_process(encoder->handle, &inFrame, &outFrame);
	xsmcSetInteger(xsResult, (xsIntegerValue)(esp_timer_get_time() - startedAt));
	xsmcSet(xsThis, xsID("encodeUs"), xsResult);
	if (ESP_AUDIO_ERR_OK != result)
		xsUnknownError("ESP Opus encode failed");
	if (!outFrame.encoded_bytes || (outFrame.encoded_bytes > outputBytes) || (outFrame.encoded_bytes > 1275))
		xsUnknownError("ESP Opus encoder returned invalid packet");
	xsmcSetInteger(xsResult, outFrame.encoded_bytes);
}
