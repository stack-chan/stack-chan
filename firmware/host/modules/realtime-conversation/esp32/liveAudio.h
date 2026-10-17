// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

#ifndef MOD_LIVE_AUDIO_H
#define MOD_LIVE_AUDIO_H

#include <stdatomic.h>
#include "esp_webrtc.h"

typedef struct LiveAudio LiveAudio;
typedef struct {
	unsigned captured, rendered, underruns, overruns;
	unsigned micLevel, cleanLevel, referenceLevel;
	unsigned outputIdleMs, silenceMs, maxSilenceMs, sourceSamples;
	unsigned requestedRate, requestedChannels, sourceFrameBytes;
	unsigned audibleMs;
} LiveAudioStats;

int liveAudioOpen(LiveAudio **audio, esp_webrtc_media_provider_t *provider);
void liveAudioStop(LiveAudio *audio);
void liveAudioClose(LiveAudio *audio);
void liveAudioMute(LiveAudio *audio, bool mute);
void liveAudioVolume(LiveAudio *audio, unsigned volume);
void liveAudioStats(LiveAudio *audio, LiveAudioStats *stats);
int liveAudioError(LiveAudio *audio);
const char *liveAudioStage(LiveAudio *audio);
/* Optional native capture transform: mono PCM16 at 16 kHz, before encoding.
 * No-op by default. A strong application symbol may override the weak hook. */
void liveAudioTransformCapture(int16_t *samples, size_t count);

#endif
