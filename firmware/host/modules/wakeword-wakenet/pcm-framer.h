// SPDX-License-Identifier: Apache-2.0
#ifndef STACKCHAN_WAKENET_PCM_FRAMER_H
#define STACKCHAN_WAKENET_PCM_FRAMER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef bool (*WakeDetect)(void *context, int16_t *samples);

static inline bool wakeFeed(int16_t *frame, size_t frameSamples, size_t *used,
	const uint8_t *input, size_t samples, WakeDetect detect, void *context)
{
	bool detected = false;
	while (samples--) {
		int32_t code = input[0] | ((uint16_t)input[1] << 8);
		frame[(*used)++] = (int16_t)(code < 32768 ? code : code - 65536);
		input += 2;
		if (*used == frameSamples) {
			if (detect(context, frame))
				detected = true;
			*used = 0;
		}
	}
	return detected;
}

#endif
