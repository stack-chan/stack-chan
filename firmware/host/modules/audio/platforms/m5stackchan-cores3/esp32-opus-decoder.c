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
#include "esp_opus_dec.h"
#include "esp_timer.h"

#define OPUS_MAX_PACKET_BYTES 1275
typedef struct {
	void *handle;
	uint32_t outputBytes;
} xsESP32OpusRecord;

static esp_opus_dec_frame_duration_t frameDurationForMilliseconds(int milliseconds)
{
	switch (milliseconds) {
		case 10: return ESP_OPUS_DEC_FRAME_DURATION_10_MS;
		case 20: return ESP_OPUS_DEC_FRAME_DURATION_20_MS;
		case 40: return ESP_OPUS_DEC_FRAME_DURATION_40_MS;
		case 60: return ESP_OPUS_DEC_FRAME_DURATION_60_MS;
		default: return ESP_OPUS_DEC_FRAME_DURATION_INVALID;
	}
}

void xs_esp32_opus_destructor(void *data)
{
	xsESP32OpusRecord *decoder = data;
	if (!decoder)
		return;
	if (decoder->handle)
		esp_opus_dec_close(decoder->handle);
	c_free(decoder);
}

void xs_esp32_opus_constructor(xsMachine *the)
{
	int sampleRate = xsmcToInteger(xsArg(0));
	int frameDuration = xsmcToInteger(xsArg(1));
	esp_opus_dec_frame_duration_t duration = frameDurationForMilliseconds(frameDuration);
	xsESP32OpusRecord *decoder;
	esp_opus_dec_cfg_t config = {
		.sample_rate = sampleRate,
		.channel = ESP_AUDIO_MONO,
		.frame_duration = duration,
		.self_delimited = false,
	};
	uint32_t internalBefore;
	uint32_t psramBefore;
	uint32_t internalAfter;
	uint32_t psramAfter;

	if ((sampleRate != 8000) && (sampleRate != 12000) && (sampleRate != 16000) &&
		(sampleRate != 24000) && (sampleRate != 48000))
		xsRangeError("invalid Opus sample rate");
	if (duration == ESP_OPUS_DEC_FRAME_DURATION_INVALID)
		xsRangeError("invalid Opus frame duration");
	decoder = c_calloc(1, sizeof(xsESP32OpusRecord));
	if (!decoder)
		xsUnknownError("no memory for Opus decoder");
	decoder->outputBytes = sampleRate * frameDuration / 1000 * sizeof(int16_t);
	internalBefore = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	psramBefore = heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (ESP_AUDIO_ERR_OK != esp_opus_dec_open(&config, sizeof(config), &decoder->handle)) {
		c_free(decoder);
		xsUnknownError("ESP Opus decoder open failed");
	}
	internalAfter = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	psramAfter = heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	xsmcSetHostData(xsThis, decoder);

	xsmcSetInteger(xsResult, internalBefore > internalAfter ? internalBefore - internalAfter : 0);
	xsmcSet(xsThis, xsID("internalHeapBytes"), xsResult);
	xsmcSetInteger(xsResult, psramBefore > psramAfter ? psramBefore - psramAfter : 0);
	xsmcSet(xsThis, xsID("psramHeapBytes"), xsResult);
	xsmcSetInteger(xsResult, decoder->outputBytes);
	xsmcSet(xsThis, xsID("outputBytes"), xsResult);
}

void xs_esp32_opus_close(xsMachine *the)
{
	xsESP32OpusRecord *decoder = xsmcGetHostData(xsThis);
	xs_esp32_opus_destructor(decoder);
	xsmcSetHostData(xsThis, NULL);
}

void xs_esp32_opus_decode(xsMachine *the)
{
	xsESP32OpusRecord *decoder = xsmcGetHostData(xsThis);
	uint8_t *input;
	uint8_t *output;
	xsUnsignedValue inputBytes;
	xsUnsignedValue outputBytes;
	esp_audio_dec_in_raw_t raw = {0};
	esp_audio_dec_out_frame_t frame = {0};
	esp_audio_dec_info_t info = {0};
	esp_audio_err_t result;
	int64_t startedAt;

	if (!decoder)
		xsUnknownError("Opus decoder is closed");
	xsmcGetBufferReadable(xsArg(0), (void **)&input, &inputBytes);
	xsmcGetBufferWritable(xsArg(1), (void **)&output, &outputBytes);
	if (!inputBytes || (inputBytes > OPUS_MAX_PACKET_BYTES))
		xsRangeError("invalid Opus packet size");
	if (outputBytes < decoder->outputBytes)
		xsRangeError("Opus output buffer too small");

	raw.buffer = input;
	raw.len = inputBytes;
	raw.frame_recover = ESP_AUDIO_DEC_RECOVERY_NONE;
	frame.buffer = output;
	frame.len = outputBytes;
	startedAt = esp_timer_get_time();
	result = esp_opus_dec_decode(decoder->handle, &raw, &frame, &info);
	xsmcSetInteger(xsResult, (xsIntegerValue)(esp_timer_get_time() - startedAt));
	xsmcSet(xsThis, xsID("decodeUs"), xsResult);
	if (ESP_AUDIO_ERR_OK != result)
		xsUnknownError("ESP Opus decode failed");
	if (raw.consumed != inputBytes)
		xsUnknownError("ESP Opus decoder did not consume one packet");
	if (!frame.decoded_size || (frame.decoded_size > outputBytes) || (frame.decoded_size & 1))
		xsUnknownError("ESP Opus decoder returned invalid PCM");
	xsmcSetInteger(xsResult, frame.decoded_size);
}
