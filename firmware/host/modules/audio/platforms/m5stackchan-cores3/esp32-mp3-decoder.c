#include "xsHost.h"
#include "xsmc.h"
#include "mc.xs.h"

#include "esp_heap_caps.h"
#include "esp_memory_utils.h"
#include "esp_mp3_dec.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define MP3_MAX_SAMPLES_PER_FRAME 1152
#define MP3_MAX_CHANNELS 2
#define MP3_PCM_SCRATCH_BYTES (MP3_MAX_SAMPLES_PER_FRAME * MP3_MAX_CHANNELS * sizeof(int16_t))
#define MP3_RESERVOIR_BYTES 8192
#define MP3_TRACKED_ALLOCATIONS 16

static size_t gCodecInternalBytes;
static size_t gCodecPSRAMBytes;
static uint16_t gCodecInternalBlocks;
static uint16_t gCodecPSRAMBlocks;
static uint8_t gTrackCodecAllocations;
static size_t gCodecAllocationBytes[MP3_TRACKED_ALLOCATIONS];
static char gCodecAllocationHeap[MP3_TRACKED_ALLOCATIONS];
static uint8_t gCodecAllocationCount;
static size_t gInternalFreeBeforeOpen;
static size_t gInternalLargestBeforeOpen;
static uint8_t gScratchInPSRAM;

static void codec_track_allocation(size_t bytes, uint32_t capability)
{
	if (!gTrackCodecAllocations)
		return;
	if (gCodecAllocationCount < MP3_TRACKED_ALLOCATIONS) {
		gCodecAllocationBytes[gCodecAllocationCount] = bytes;
		gCodecAllocationHeap[gCodecAllocationCount] =
			(MALLOC_CAP_INTERNAL == capability) ? 'I' : 'P';
		gCodecAllocationCount += 1;
	}
	if (MALLOC_CAP_INTERNAL == capability) {
		gCodecInternalBytes += bytes;
		gCodecInternalBlocks += 1;
	}
	else {
		gCodecPSRAMBytes += bytes;
		gCodecPSRAMBlocks += 1;
	}
}

static void codec_log_allocations(int result)
{
	char diagnostic[256];
	size_t used;
	c_snprintf(diagnostic, sizeof(diagnostic),
		"[web-radio-decoder-memory] result=%d scratch=%c internal=%u/%u psram=%u/%u freeBefore=%u largestBefore=%u freeAfter=%u largestAfter=%u stackHighWater=%u\n",
		result,
		gScratchInPSRAM ? 'P' : 'I',
		(unsigned int)gCodecInternalBytes, (unsigned int)gCodecInternalBlocks,
		(unsigned int)gCodecPSRAMBytes, (unsigned int)gCodecPSRAMBlocks,
		(unsigned int)gInternalFreeBeforeOpen, (unsigned int)gInternalLargestBeforeOpen,
		(unsigned int)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
		(unsigned int)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
		(unsigned int)uxTaskGetStackHighWaterMark(NULL));
	modLog_transmit(diagnostic);

	used = (size_t)c_snprintf(diagnostic, sizeof(diagnostic), "[web-radio-decoder-allocations]");
	for (uint8_t index = 0; (index < gCodecAllocationCount) && (used < (sizeof(diagnostic) - 20)); index++) {
		used += (size_t)c_snprintf(diagnostic + used, sizeof(diagnostic) - used,
			" %u%c", (unsigned int)gCodecAllocationBytes[index], gCodecAllocationHeap[index]);
	}
	c_snprintf(diagnostic + used, sizeof(diagnostic) - used, "\n");
	modLog_transmit(diagnostic);
}

static void *codec_heap_allocate(size_t count, size_t size, uint8_t clear)
{
	const size_t bytes = count * size;
	const uint32_t preferred = (bytes >= MP3_RESERVOIR_BYTES) ? MALLOC_CAP_SPIRAM : MALLOC_CAP_INTERNAL;
	const uint32_t fallback = (MALLOC_CAP_SPIRAM == preferred) ? MALLOC_CAP_INTERNAL : MALLOC_CAP_SPIRAM;
	void *result;

	if (clear)
		result = heap_caps_calloc(count, size, preferred | MALLOC_CAP_8BIT);
	else
		result = heap_caps_malloc(bytes, preferred | MALLOC_CAP_8BIT);
	if (result) {
		codec_track_allocation(bytes, preferred);
		return result;
	}

	if (clear)
		result = heap_caps_calloc(count, size, fallback | MALLOC_CAP_8BIT);
	else
		result = heap_caps_malloc(bytes, fallback | MALLOC_CAP_8BIT);
	if (result)
		codec_track_allocation(bytes, fallback);
	return result;
}

/*
 * esp_audio_codec provides weak allocation hooks. CoreS3 normally routes
 * allocations larger than 16 KiB to 40 MHz PSRAM, but the MP3 decoder performs
 * frequent random access over its roughly 28 KiB work area. Keep its six hot
 * channel/granule work buffers in internal RAM. The 8 KiB compressed-data
 * reservoir is accessed mostly sequentially, so put that in PSRAM to avoid
 * exhausting internal RAM. Both paths retain a fallback so decoder creation
 * cannot fail solely because one heap is fragmented.
 */
void *media_lib_module_malloc(const char *module, size_t size)
{
	(void)module;
	return codec_heap_allocate(1, size, 0);
}

void *media_lib_module_calloc(const char *module, size_t count, size_t size)
{
	(void)module;
	return codec_heap_allocate(count, size, 1);
}

void *media_lib_module_realloc(const char *module, void *pointer, size_t size)
{
	const uint32_t preferred = (size >= MP3_RESERVOIR_BYTES) ? MALLOC_CAP_SPIRAM : MALLOC_CAP_INTERNAL;
	const uint32_t fallback = (MALLOC_CAP_SPIRAM == preferred) ? MALLOC_CAP_INTERNAL : MALLOC_CAP_SPIRAM;
	void *result;

	(void)module;
	result = heap_caps_realloc(pointer, size, preferred | MALLOC_CAP_8BIT);
	if (!result)
		result = heap_caps_realloc(pointer, size, fallback | MALLOC_CAP_8BIT);
	return result;
}

void media_lib_free(void *pointer)
{
	heap_caps_free(pointer);
}

typedef struct {
	void *handle;
	int16_t *scratch;
} xsESP32MP3Record;

void xs_esp32_mp3_destructor(void *data)
{
	xsESP32MP3Record *decoder = data;
	if (!decoder)
		return;
	if (decoder->handle)
		esp_mp3_dec_close(decoder->handle);
	if (decoder->scratch)
		heap_caps_free(decoder->scratch);
	c_free(decoder);
}

void xs_esp32_mp3_constructor(xsMachine *the)
{
	xsESP32MP3Record *decoder = c_calloc(1, sizeof(xsESP32MP3Record));
	esp_audio_err_t openResult;
	if (!decoder)
		xsUnknownError("no memory for MP3 decoder");

	decoder->scratch = heap_caps_malloc(MP3_PCM_SCRATCH_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (!decoder->scratch)
		decoder->scratch = heap_caps_malloc(MP3_PCM_SCRATCH_BYTES, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	if (!decoder->scratch) {
		c_free(decoder);
		xsUnknownError("no memory for MP3 PCM buffer");
	}

	gCodecInternalBytes = 0;
	gCodecPSRAMBytes = 0;
	gCodecInternalBlocks = 0;
	gCodecPSRAMBlocks = 0;
	gCodecAllocationCount = 0;
	gScratchInPSRAM = esp_ptr_external_ram(decoder->scratch) ? 1 : 0;
	gInternalFreeBeforeOpen = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	gInternalLargestBeforeOpen = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
	gTrackCodecAllocations = 1;
	openResult = esp_mp3_dec_open(NULL, 0, &decoder->handle);
	if (ESP_AUDIO_ERR_OK != openResult) {
		gTrackCodecAllocations = 0;
		codec_log_allocations((int)openResult);
		heap_caps_free(decoder->scratch);
		c_free(decoder);
		xsUnknownError("ESP MP3 decoder open failed");
	}

	xsmcSetHostData(xsThis, decoder);
}

void xs_esp32_mp3_close(xsMachine *the)
{
	xsESP32MP3Record *decoder = xsmcGetHostData(xsThis);
	xs_esp32_mp3_destructor(decoder);
	xsmcSetHostData(xsThis, NULL);
}

void xs_esp32_mp3_decode(xsMachine *the)
{
	xsESP32MP3Record *decoder = xsmcGetHostData(xsThis);
	uint8_t *input;
	int16_t *output;
	xsUnsignedValue inputBytes;
	xsUnsignedValue outputBytes;
	esp_audio_dec_in_raw_t raw = {0};
	esp_audio_dec_out_frame_t frame = {0};
	esp_audio_dec_info_t info = {0};
	esp_audio_err_t result;
	uint32_t consumed;
	uint32_t samples;

	if (!decoder)
		xsUnknownError("MP3 decoder is closed");
	xsmcGetBufferReadable(xsArg(0), (void **)&input, &inputBytes);
	xsmcGetBufferWritable(xsArg(1), (void **)&output, &outputBytes);
	if (outputBytes < (MP3_MAX_SAMPLES_PER_FRAME * sizeof(int16_t)))
		xsRangeError("MP3 output buffer too small");

	raw.buffer = input;
	raw.len = inputBytes;
	frame.buffer = (uint8_t *)decoder->scratch;
	frame.len = MP3_PCM_SCRATCH_BYTES;
	result = esp_mp3_dec_decode(decoder->handle, &raw, &frame, &info);
	if (gTrackCodecAllocations) {
		gTrackCodecAllocations = 0;
		codec_log_allocations((int)result);
	}
	consumed = raw.consumed ? raw.consumed : inputBytes;
	if (consumed > inputBytes)
		xsUnknownError("MP3 decoder consumed invalid input length");

	if (ESP_AUDIO_ERR_OK != result) {
		if ((ESP_AUDIO_ERR_FAIL != result) &&
			(ESP_AUDIO_ERR_DATA_LACK != result) &&
			(ESP_AUDIO_ERR_HEADER_PARSE != result))
			xsUnknownError("ESP MP3 decode failed");
		xsmcSetInteger(xsResult, 0);
		xsmcSet(xsArg(1), xsID_samples, xsResult);
		xsmcSetInteger(xsResult, consumed);
		return;
	}

	if ((16 != info.bits_per_sample) || ((1 != info.channel) && (2 != info.channel)))
		xsUnknownError("unsupported MP3 PCM format");
	samples = frame.decoded_size / (sizeof(int16_t) * info.channel);
	if ((samples > MP3_MAX_SAMPLES_PER_FRAME) || (outputBytes < (samples * sizeof(int16_t))))
		xsRangeError("MP3 decoded frame is too large");

	if (1 == info.channel)
		c_memcpy(output, decoder->scratch, samples * sizeof(int16_t));
	else {
		int16_t *source = decoder->scratch;
		uint32_t count = samples;
		while (count--) {
			int32_t mixed = (int32_t)source[0] + source[1];
			*output++ = (int16_t)(mixed / 2);
			source += 2;
		}
	}

	xsmcSetInteger(xsResult, samples);
	xsmcSet(xsArg(1), xsID_samples, xsResult);
	xsmcSetInteger(xsResult, consumed);
}
