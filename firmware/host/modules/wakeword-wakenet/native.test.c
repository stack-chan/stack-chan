// SPDX-License-Identifier: Apache-2.0

#include "model-format.h"
#include "pcm-framer.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

static int packets;
static bool detect(void *context, int16_t *samples)
{
	const int16_t *expected = context;
	for (size_t i = 0; i < 3; ++i)
		assert(samples[i] == expected[packets * 3 + i]);
	return ++packets == 1;
}

int main(int argc, char **argv)
{
	assert(argc == 2);
	FILE *f = fopen(argv[1], "rb");
	assert(f);
	uint8_t *pack = malloc(WAKE_MODEL_SIZE + 1);
	assert(pack);
	assert(fread(pack, 1, WAKE_MODEL_SIZE + 1, f) == WAKE_MODEL_SIZE);
	fclose(f);

	assert(wakeModelValid(pack, WAKE_MODEL_SIZE));
	assert(!wakeModelValid(pack + 1, WAKE_MODEL_SIZE - 1));
	assert(!wakeModelValid(pack, WAKE_MODEL_HEADER - 1));
	assert(!wakeModelValid(pack, WAKE_MODEL_SIZE + 1));
	const size_t invalid[] = {0, 4, 30, 36, 40, 72, 76, 112, 116, 152, 156};
	for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); ++i) {
		pack[invalid[i]] ^= 0x80;
		assert(!wakeModelValid(pack, WAKE_MODEL_SIZE));
		pack[invalid[i]] ^= 0x80;
	}
	assert(wakeModelValid(pack, WAKE_MODEL_SIZE));
	free(pack);

	int16_t frame[3];
	int16_t expected[] = {32767, -32768, -1, 1, -2, 256};
	const uint8_t input[] = {255, 127, 0, 128, 255, 255, 1, 0, 254, 255, 0, 1};
	size_t used = 0;
	assert(!wakeFeed(frame, 3, &used, input, 2, detect, expected));
	assert(used == 2 && packets == 0);
	assert(wakeFeed(frame, 3, &used, input + 4, 4, detect, expected));
	assert(used == 0 && packets == 2);
	assert(!wakeFeed(frame, 3, &used, input, 2, detect, expected));
	assert(used == 2);
	used = 0; // reset; next frame must not include the earlier fragment.
	packets = 0;
	assert(wakeFeed(frame, 3, &used, input, 3, detect, expected));
	assert(used == 0 && packets == 1);
	puts("PASS pinned model envelope, malformed bounds, fragmented PCM and reset");
	return 0;
}
