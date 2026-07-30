/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

#include "xsmc.h"
#include "xsHost.h"

#include "esp_aec.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"

#include <math.h>
#include <stdlib.h>

#include "audio-aec.h"

#define STACKCHAN_AEC_SAMPLE_RATE 16000
#define STACKCHAN_AEC_ALIGNMENT 16
#define STACKCHAN_AEC_DEFAULT_FILTER_LENGTH 4
#define STACKCHAN_AEC_MIN_INTERNAL_FREE_BYTES (64 * 1024)
#define STACKCHAN_AEC_SELF_TEST_FRAMES 48
#define STACKCHAN_AEC_SELF_TEST_DOUBLE_TALK_FRAMES 24
#define STACKCHAN_AEC_SELF_TEST_DELAY_SAMPLES 160

struct StackchanAudioAecRecord {
	aec_handle_t *handle;
	int frameSamples;
	int16_t *microphone;
	int16_t *reference;
	int16_t *output;
	uint32_t memoryCaps;
	uint32_t internalFreeBytes;
};

static int16_t *stackchanAudioAecAllocateSamples(int samples)
{
	size_t bytes = samples * sizeof(int16_t);
	int16_t *buffer = heap_caps_aligned_alloc(
		STACKCHAN_AEC_ALIGNMENT,
		bytes,
		MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT
	);

	if (!buffer)
		buffer = heap_caps_aligned_alloc(
			STACKCHAN_AEC_ALIGNMENT,
			bytes,
			MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
		);
	return buffer;
}

StackchanAudioAec stackchanAudioAecCreate(int filterLength, int nlpLevel)
{
	StackchanAudioAec aec;
	aec_config_t config;

	if (filterLength <= 0)
		filterLength = STACKCHAN_AEC_DEFAULT_FILTER_LENGTH;
	if ((nlpLevel < kStackchanAudioAecNlpNormal) ||
		(nlpLevel > kStackchanAudioAecNlpVeryAggressive))
		nlpLevel = kStackchanAudioAecNlpNormal;

	aec = heap_caps_calloc(1, sizeof(StackchanAudioAecRecord), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	if (!aec)
		return C_NULL;

	config = (aec_config_t){
		.mic_num = 1,
		.ref_num = 1,
		.out_num = 1,
		.filter_length = filterLength,
		.sample_rate = STACKCHAN_AEC_SAMPLE_RATE,
		.caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT,
		.mode = AEC_MODE_FD_LOW_COST,
		.nlp_level = (aec_nlp_level_t)nlpLevel,
	};
	aec->handle = aec_create_from_config(&config);
	if (aec->handle &&
		(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) <
			STACKCHAN_AEC_MIN_INTERNAL_FREE_BYTES)) {
		aec_destroy(aec->handle);
		aec->handle = C_NULL;
	}
	if (!aec->handle) {
		config.caps = MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT;
		aec->handle = aec_create_from_config(&config);
	}
	if (!aec->handle)
		goto bail;
	aec->memoryCaps = config.caps;

	aec->frameSamples = aec_get_chunksize(aec->handle);
	if (aec->frameSamples <= 0)
		goto bail;

	aec->microphone = stackchanAudioAecAllocateSamples(aec->frameSamples);
	aec->reference = stackchanAudioAecAllocateSamples(aec->frameSamples);
	aec->output = stackchanAudioAecAllocateSamples(aec->frameSamples);
	if (!aec->microphone || !aec->reference || !aec->output)
		goto bail;
	aec->internalFreeBytes =
		heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);

	return aec;

bail:
	stackchanAudioAecDestroy(aec);
	return C_NULL;
}

void stackchanAudioAecDestroy(StackchanAudioAec aec)
{
	if (!aec)
		return;
	if (aec->handle)
		aec_destroy(aec->handle);
	if (aec->microphone)
		heap_caps_free(aec->microphone);
	if (aec->reference)
		heap_caps_free(aec->reference);
	if (aec->output)
		heap_caps_free(aec->output);
	heap_caps_free(aec);
}

int stackchanAudioAecGetFrameSamples(StackchanAudioAec aec)
{
	return aec ? aec->frameSamples : 0;
}

int stackchanAudioAecUsesInternalMemory(StackchanAudioAec aec)
{
	return aec ? !!(aec->memoryCaps & MALLOC_CAP_INTERNAL) : 0;
}

uint32_t stackchanAudioAecGetInternalFreeBytes(StackchanAudioAec aec)
{
	return aec ? aec->internalFreeBytes : 0;
}

int stackchanAudioAecProcess(
	StackchanAudioAec aec,
	const int16_t *microphone,
	const int16_t *reference,
	int16_t *output
)
{
	size_t bytes;

	if (!aec || !microphone || !reference || !output)
		return 0;

	bytes = aec->frameSamples * sizeof(int16_t);
	c_memcpy(aec->microphone, microphone, bytes);
	c_memcpy(aec->reference, reference, bytes);
	aec_process(aec->handle, aec->microphone, aec->reference, aec->output);
	c_memcpy(output, aec->output, bytes);
	return aec->frameSamples;
}

static int16_t stackchanAudioAecSelfTestReference(uint32_t *state, int32_t *filtered)
{
	int32_t white;

	*state ^= *state << 13;
	*state ^= *state >> 17;
	*state ^= *state << 5;
	white = (int16_t)(*state >> 16);
	*filtered = ((*filtered * 3) + white) >> 2;
	return (int16_t)(*filtered >> 1);
}

static int16_t stackchanAudioAecClampSample(int32_t sample)
{
	if (sample > 32767)
		return 32767;
	if (sample < -32768)
		return -32768;
	return (int16_t)sample;
}

void xs_audio_aec_self_test(xsMachine *the)
{
	StackchanAudioAec aec;
	int16_t *microphone = C_NULL;
	int16_t *reference = C_NULL;
	int16_t *output = C_NULL;
	int16_t *nearEnd = C_NULL;
	int16_t *nearEndCapture = C_NULL;
	int16_t *doubleTalkOutputCapture = C_NULL;
	int16_t delayLine[STACKCHAN_AEC_SELF_TEST_DELAY_SAMPLES];
	uint32_t randomState = 0x6d2b79f5;
	uint32_t nearEndRandomState = 0xa511e9b3;
	int32_t filtered = 0;
	int32_t nearEndFiltered = 0;
	uint32_t delayOffset = 0;
	uint64_t microphoneEnergy = 0;
	uint64_t outputEnergy = 0;
	uint64_t referenceEnergy = 0;
	uint64_t nearEndEnergy = 0;
	uint64_t doubleTalkOutputEnergy = 0;
	uint64_t nearEndErrorEnergy = 0;
	uint64_t maximumProcessUs = 0;
	uint64_t totalProcessUs = 0;
	int64_t nearEndOutputCorrelation = 0;
	int nearEndDelaySamples = 0;
	int doubleTalkSamples;
	int frameSamples;
	int frame;
	int sample;
	double suppressionDb;
	double nearEndCorrelation;
	double nearEndGainDb;
	double nearEndErrorDb;

	(void)the;
	aec = stackchanAudioAecCreate(
		STACKCHAN_AEC_DEFAULT_FILTER_LENGTH,
		kStackchanAudioAecNlpNormal
	);
	if (!aec)
		xsUnknownError("unable to create ESP-SR AEC");

	frameSamples = stackchanAudioAecGetFrameSamples(aec);
	doubleTalkSamples = frameSamples * STACKCHAN_AEC_SELF_TEST_DOUBLE_TALK_FRAMES;
	microphone = stackchanAudioAecAllocateSamples(frameSamples);
	reference = stackchanAudioAecAllocateSamples(frameSamples);
	output = stackchanAudioAecAllocateSamples(frameSamples);
	nearEnd = stackchanAudioAecAllocateSamples(frameSamples);
	nearEndCapture = stackchanAudioAecAllocateSamples(doubleTalkSamples);
	doubleTalkOutputCapture = stackchanAudioAecAllocateSamples(doubleTalkSamples);
	if (!microphone || !reference || !output || !nearEnd ||
		!nearEndCapture || !doubleTalkOutputCapture)
		goto memory_error;

	c_memset(delayLine, 0, sizeof(delayLine));
	for (frame = 0; frame < STACKCHAN_AEC_SELF_TEST_FRAMES; frame++) {
		int64_t startedUs;
		uint64_t elapsedUs;

		for (sample = 0; sample < frameSamples; sample++) {
			int16_t playback = stackchanAudioAecSelfTestReference(&randomState, &filtered);
			int16_t delayed = delayLine[delayOffset];
			int32_t echo = ((int32_t)delayed * 3) >> 2;

			delayLine[delayOffset] = playback;
			delayOffset += 1;
			if (delayOffset == STACKCHAN_AEC_SELF_TEST_DELAY_SAMPLES)
				delayOffset = 0;

			reference[sample] = playback;
			microphone[sample] = (int16_t)echo;
		}

		startedUs = esp_timer_get_time();
		stackchanAudioAecProcess(aec, microphone, reference, output);
		elapsedUs = esp_timer_get_time() - startedUs;
		totalProcessUs += elapsedUs;
		if (maximumProcessUs < elapsedUs)
			maximumProcessUs = elapsedUs;

		if (frame >= (STACKCHAN_AEC_SELF_TEST_FRAMES / 2)) {
			for (sample = 0; sample < frameSamples; sample++) {
				int32_t mic = microphone[sample];
				int32_t ref = reference[sample];
				int32_t clean = output[sample];
				microphoneEnergy += (int64_t)mic * mic;
				referenceEnergy += (int64_t)ref * ref;
				outputEnergy += (int64_t)clean * clean;
			}
		}
	}

	suppressionDb = 10.0 * log10(
		((double)microphoneEnergy + 1.0) / ((double)outputEnergy + 1.0)
	);

	for (frame = 0; frame < STACKCHAN_AEC_SELF_TEST_DOUBLE_TALK_FRAMES; frame++) {
		int64_t startedUs;
		uint64_t elapsedUs;

		for (sample = 0; sample < frameSamples; sample++) {
			int16_t playback = stackchanAudioAecSelfTestReference(&randomState, &filtered);
			int16_t delayed = delayLine[delayOffset];
			int16_t localSpeech = stackchanAudioAecSelfTestReference(
				&nearEndRandomState,
				&nearEndFiltered
			);
			int32_t echo = ((int32_t)delayed * 3) >> 2;

			delayLine[delayOffset] = playback;
			delayOffset += 1;
			if (delayOffset == STACKCHAN_AEC_SELF_TEST_DELAY_SAMPLES)
				delayOffset = 0;

			reference[sample] = playback;
			nearEnd[sample] = localSpeech;
			microphone[sample] = stackchanAudioAecClampSample(echo + localSpeech);
		}

		startedUs = esp_timer_get_time();
		stackchanAudioAecProcess(aec, microphone, reference, output);
		elapsedUs = esp_timer_get_time() - startedUs;
		totalProcessUs += elapsedUs;
		if (maximumProcessUs < elapsedUs)
			maximumProcessUs = elapsedUs;

		c_memcpy(
			nearEndCapture + (frame * frameSamples),
			nearEnd,
			frameSamples * sizeof(int16_t)
		);
		c_memcpy(
			doubleTalkOutputCapture + (frame * frameSamples),
			output,
			frameSamples * sizeof(int16_t)
		);
	}

	{
		int maximumDelay = frameSamples * 2;
		int lag;
		double bestScore = -1;

		for (lag = -maximumDelay; lag <= maximumDelay; lag++) {
			int nearEndStart = (lag < 0) ? -lag : 0;
			int outputStart = (lag > 0) ? lag : 0;
			int overlap = doubleTalkSamples - abs(lag);
			uint64_t candidateNearEndEnergy = 0;
			uint64_t candidateOutputEnergy = 0;
			int64_t candidateCorrelation = 0;
			double normalizedCorrelation;
			double score;

			for (sample = 0; sample < overlap; sample++) {
				int32_t localSpeech = nearEndCapture[nearEndStart + sample];
				int32_t clean = doubleTalkOutputCapture[outputStart + sample];
				candidateNearEndEnergy += (int64_t)localSpeech * localSpeech;
				candidateOutputEnergy += (int64_t)clean * clean;
				candidateCorrelation += (int64_t)localSpeech * clean;
			}

			normalizedCorrelation =
				(candidateNearEndEnergy && candidateOutputEnergy)
					? ((double)candidateCorrelation /
						sqrt(
							(double)candidateNearEndEnergy *
							(double)candidateOutputEnergy
						))
					: 0;
			score = fabs(normalizedCorrelation);
			if (score > bestScore) {
				bestScore = score;
				nearEndDelaySamples = lag;
				nearEndEnergy = candidateNearEndEnergy;
				doubleTalkOutputEnergy = candidateOutputEnergy;
				nearEndOutputCorrelation = candidateCorrelation;
			}
		}
	}

	{
		int nearEndStart = (nearEndDelaySamples < 0) ? -nearEndDelaySamples : 0;
		int outputStart = (nearEndDelaySamples > 0) ? nearEndDelaySamples : 0;
		int overlap = doubleTalkSamples - abs(nearEndDelaySamples);

		for (sample = 0; sample < overlap; sample++) {
			int32_t localSpeech = nearEndCapture[nearEndStart + sample];
			int32_t clean = doubleTalkOutputCapture[outputStart + sample];
			int32_t error = clean - localSpeech;
			nearEndErrorEnergy += (int64_t)error * error;
		}
	}

	nearEndCorrelation = (nearEndEnergy && doubleTalkOutputEnergy)
		? ((double)nearEndOutputCorrelation /
			sqrt((double)nearEndEnergy * (double)doubleTalkOutputEnergy))
		: 0;
	nearEndGainDb = 10.0 * log10(
		((double)doubleTalkOutputEnergy + 1.0) / ((double)nearEndEnergy + 1.0)
	);
	nearEndErrorDb = 10.0 * log10(
		((double)nearEndErrorEnergy + 1.0) / ((double)nearEndEnergy + 1.0)
	);

	xsmcVars(1);
	xsmcSetNewObject(xsResult);
	xsmcSetInteger(xsVar(0), frameSamples);
	xsmcSet(xsResult, xsID("frameSamples"), xsVar(0));
	xsmcSetInteger(
		xsVar(0),
		STACKCHAN_AEC_SELF_TEST_FRAMES + STACKCHAN_AEC_SELF_TEST_DOUBLE_TALK_FRAMES
	);
	xsmcSet(xsResult, xsID("processedFrames"), xsVar(0));
	xsmcSetNumber(xsVar(0), suppressionDb);
	xsmcSet(xsResult, xsID("suppressionDb"), xsVar(0));
	xsmcSetNumber(xsVar(0), (xsNumberValue)microphoneEnergy);
	xsmcSet(xsResult, xsID("microphoneEnergy"), xsVar(0));
	xsmcSetNumber(xsVar(0), (xsNumberValue)referenceEnergy);
	xsmcSet(xsResult, xsID("referenceEnergy"), xsVar(0));
	xsmcSetNumber(xsVar(0), (xsNumberValue)outputEnergy);
	xsmcSet(xsResult, xsID("outputEnergy"), xsVar(0));
	xsmcSetInteger(xsVar(0), STACKCHAN_AEC_SELF_TEST_DOUBLE_TALK_FRAMES);
	xsmcSet(xsResult, xsID("doubleTalkFrames"), xsVar(0));
	xsmcSetNumber(xsVar(0), (xsNumberValue)nearEndEnergy);
	xsmcSet(xsResult, xsID("nearEndEnergy"), xsVar(0));
	xsmcSetNumber(xsVar(0), (xsNumberValue)doubleTalkOutputEnergy);
	xsmcSet(xsResult, xsID("doubleTalkOutputEnergy"), xsVar(0));
	xsmcSetInteger(xsVar(0), nearEndDelaySamples);
	xsmcSet(xsResult, xsID("nearEndDelaySamples"), xsVar(0));
	xsmcSetNumber(xsVar(0), nearEndCorrelation);
	xsmcSet(xsResult, xsID("nearEndCorrelation"), xsVar(0));
	xsmcSetNumber(xsVar(0), nearEndGainDb);
	xsmcSet(xsResult, xsID("nearEndGainDb"), xsVar(0));
	xsmcSetNumber(xsVar(0), nearEndErrorDb);
	xsmcSet(xsResult, xsID("nearEndErrorDb"), xsVar(0));
	xsmcSetNumber(
		xsVar(0),
		(xsNumberValue)(
			totalProcessUs /
			(STACKCHAN_AEC_SELF_TEST_FRAMES + STACKCHAN_AEC_SELF_TEST_DOUBLE_TALK_FRAMES)
		)
	);
	xsmcSet(xsResult, xsID("averageProcessUs"), xsVar(0));
	xsmcSetNumber(xsVar(0), (xsNumberValue)maximumProcessUs);
	xsmcSet(xsResult, xsID("maximumProcessUs"), xsVar(0));

	heap_caps_free(microphone);
	heap_caps_free(reference);
	heap_caps_free(output);
	heap_caps_free(nearEnd);
	heap_caps_free(nearEndCapture);
	heap_caps_free(doubleTalkOutputCapture);
	stackchanAudioAecDestroy(aec);
	return;

memory_error:
	if (microphone)
		heap_caps_free(microphone);
	if (reference)
		heap_caps_free(reference);
	if (output)
		heap_caps_free(output);
	if (nearEnd)
		heap_caps_free(nearEnd);
	if (nearEndCapture)
		heap_caps_free(nearEndCapture);
	if (doubleTalkOutputCapture)
		heap_caps_free(doubleTalkOutputCapture);
	stackchanAudioAecDestroy(aec);
	xsRangeError("not enough memory for AEC self-test");
}
