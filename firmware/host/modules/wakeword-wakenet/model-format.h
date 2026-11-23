// SPDX-License-Identifier: Apache-2.0
#ifndef STACKCHAN_WAKENET_MODEL_FORMAT_H
#define STACKCHAN_WAKENET_MODEL_FORMAT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define WAKE_MODEL_NAME "wn9l_histackchan_tts3"
#define WAKE_MODEL_RESOURCE "stackchan-wakenet-v247.bin"
#define WAKE_MODEL_SIZE 292607
#define WAKE_MODEL_HEADER 160
#define WAKE_MODEL_CRC32 UINT32_C(0x6923b57e)
#define WAKE_MODEL_RATE 16000
#define WAKE_MAX_CHUNK_SAMPLES 2048
#define WAKE_MAX_INPUT_BYTES 8192

static inline uint32_t wakeReadLE32(const uint8_t *p)
{
	return (uint32_t)p[0] | (uint32_t)p[1] << 8 |
		(uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

static inline bool wakeNameMatches(const uint8_t *field, const char *name)
{
	size_t length = strlen(name);
	if (memcmp(field, name, length))
		return false;
	for (size_t i = length; i < 32; ++i)
		if (field[i]) return false;
	return true;
}

/* esp-sr 2.4.7's srmodel_load has no size parameter. Admit only the pinned
 * package layout read from the host ROM (not a MOD/SD/xs archive resource). */
static inline bool wakeModelValid(const uint8_t *model, size_t size)
{
	static const char *const names[] = {"wn9_index", "wn9_data", "_MODEL_INFO_"};
	static const uint32_t sizes[] = {1200, 291201, 46};
	if (!model || size != WAKE_MODEL_SIZE || ((uintptr_t)model & 3u))
		return false;
	if (wakeReadLE32(model) != 1 || !wakeNameMatches(model + 4, WAKE_MODEL_NAME) ||
		wakeReadLE32(model + 36) != 3)
		return false;
	size_t offset = WAKE_MODEL_HEADER;
	for (size_t i = 0; i < 3; ++i) {
		const uint8_t *field = model + 40 + i * 40;
		if (!wakeNameMatches(field, names[i]) || wakeReadLE32(field + 32) != offset ||
			wakeReadLE32(field + 36) != sizes[i] || sizes[i] > size - offset)
			return false;
		offset += sizes[i];
	}
	return offset == size;
}

#endif
