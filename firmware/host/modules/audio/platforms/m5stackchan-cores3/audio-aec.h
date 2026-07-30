/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

#ifndef STACKCHAN_AUDIO_AEC_H
#define STACKCHAN_AUDIO_AEC_H

#include <stdint.h>

typedef struct StackchanAudioAecRecord StackchanAudioAecRecord;
typedef StackchanAudioAecRecord *StackchanAudioAec;

enum {
	kStackchanAudioAecNlpNormal = 0,
	kStackchanAudioAecNlpAggressive = 1,
	kStackchanAudioAecNlpVeryAggressive = 2,
};

StackchanAudioAec stackchanAudioAecCreate(int filterLength, int nlpLevel);
void stackchanAudioAecDestroy(StackchanAudioAec aec);
int stackchanAudioAecGetFrameSamples(StackchanAudioAec aec);
int stackchanAudioAecUsesInternalMemory(StackchanAudioAec aec);
uint32_t stackchanAudioAecGetInternalFreeBytes(StackchanAudioAec aec);
int stackchanAudioAecProcess(
	StackchanAudioAec aec,
	const int16_t *microphone,
	const int16_t *reference,
	int16_t *output
);

#endif
