#include "xsmc.h"
#include "xsHost.h"
#include "commodettoBitmap.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#if ESP32
#include "rom/tjpgd.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
typedef UINT OutputResult;
static uint64_t now_ms(void) { return esp_timer_get_time() / 1000; }
static void yield_decoder(void) { vTaskDelay(1); }
#else
#include "tjpgd.h"
#include <time.h>
#include <unistd.h>
typedef int OutputResult;
static uint64_t now_ms(void) {
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return (uint64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static void yield_decoder(void) { usleep(1000); }
#endif

#define SIZE 64
#define WORK_BYTES 3100
#if (kCommodettoBitmapFormat != kCommodettoBitmapRGB565LE) && (kCommodettoBitmapFormat != kCommodettoBitmapRGB565BE)
#error "JPEG thumbnails require an RGB565 display"
#endif
/* Shared state: producer write, consumer read, EOF, cancellation. */
typedef struct {
	uint8_t *ring, *pixels;
	int32_t *state;
	uint32_t capacity, width, height, fitW, fitH, left, top;
	uint32_t consumed, blocks, tail;
	uint32_t minFreeHeap, minFreeInternal;
	uint64_t started, wait_ms;
} Thumbnail;
static uint32_t load_state(Thumbnail *t, int index) {
	return __atomic_load_n(t->state + index, __ATOMIC_ACQUIRE);
}
static int cancelled(Thumbnail *t) {
	return load_state(t, 3) || now_ms() - t->started > 90000;
}
static unsigned int input(JDEC *jd, uint8_t *target, unsigned int requested) {
	Thumbnail *t = jd->device;
	unsigned int count = 0;
	while (count < requested && !cancelled(t)) {
		uint32_t read = load_state(t, 1), available = load_state(t, 0) - read;
		if (!available) {
			if (load_state(t, 2)) break;
			uint64_t start = now_ms();
			yield_decoder();
			t->wait_ms += now_ms() - start;
			continue;
		}
		if (available > t->capacity) break;
		uint32_t offset = read % t->capacity, n = t->capacity - offset;
		if (n > available) n = available;
		if (n > requested - count) n = requested - count;
		if (target) memcpy(target + count, t->ring + offset, n);
		for (uint32_t i = 0; i < n; i++) t->tail = ((t->tail << 8) | t->ring[offset + i]) & 0xffff;
		count += n;
		t->consumed += n;
		__atomic_store_n(t->state + 1, read + n, __ATOMIC_RELEASE);
	}
	return count;
}
static OutputResult output(JDEC *jd, void *data, JRECT *rect) {
	Thumbnail *t = jd->device;
	if (cancelled(t)) return 0;
	const uint8_t *rgb = data;
	uint32_t blockW = rect->right - rect->left + 1;
	/* Samples refer to pixel centres in the scaled image; letterboxing preserves aspect ratio. */
	for (uint32_t y = 0; y < t->fitH; y++) {
		uint32_t sy = ((2 * y + 1) * t->height) / (2 * t->fitH);
		if (sy < rect->top || sy > rect->bottom) continue;
		for (uint32_t x = 0; x < t->fitW; x++) {
			uint32_t sx = ((2 * x + 1) * t->width) / (2 * t->fitW);
			if (sx < rect->left || sx > rect->right) continue;
			const uint8_t *p = rgb + ((sy - rect->top) * blockW + sx - rect->left) * 3;
			uint16_t color = ((p[0] & 0xf8) << 8) | ((p[1] & 0xfc) << 3) | (p[2] >> 3);
			uint32_t offset = ((y + t->top) * SIZE + x + t->left) * 2;
			/* Poco silently ignores bitmaps whose format differs from the display. */
#if kCommodettoBitmapFormat == kCommodettoBitmapRGB565BE
			t->pixels[offset] = color >> 8;
			t->pixels[offset + 1] = color;
#else
			t->pixels[offset] = color;
			t->pixels[offset + 1] = color >> 8;
#endif
		}
	}
	/* Let networking and audio progress even when compressed bytes are already available. */
	if (!(++t->blocks % 128)) {
#if ESP32
		uint32_t freeHeap = heap_caps_get_free_size(MALLOC_CAP_8BIT);
		uint32_t freeInternal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
		if (freeHeap < t->minFreeHeap) t->minFreeHeap = freeHeap;
		if (freeInternal < t->minFreeInternal) t->minFreeInternal = freeInternal;
#endif
		yield_decoder();
	}
	return !cancelled(t);
}
void xs_jpeg_thumbnail(xsMachine *the) {
	Thumbnail t = {0};
	xsUnsignedValue inputBytes, stateBytes, pixelBytes;
	xsmcGetBufferReadable(xsArg(0), (void **)&t.ring, &inputBytes);
	xsmcGetBufferWritable(xsArg(1), (void **)&t.state, &stateBytes);
	xsmcGetBufferWritable(xsArg(2), (void **)&t.pixels, &pixelBytes);
	if (inputBytes < 512 || stateBytes != 16 || pixelBytes != SIZE * SIZE * 2)
		xsRangeError("Invalid thumbnail buffers");
	t.capacity = inputBytes;
	t.started = now_ms();
	void *work = malloc(WORK_BYTES);
	if (!work) xsUnknownError("JPEG workspace allocation failed");
#if ESP32
	t.minFreeHeap = heap_caps_get_free_size(MALLOC_CAP_8BIT);
	t.minFreeInternal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
#endif
	JDEC jd = {0};
	JRESULT result = jd_prepare(&jd, input, work, WORK_BYTES, &t);
	uint32_t originalW = jd.width, originalH = jd.height;
	uint8_t scale = 0;
	if (result == JDR_OK) {
		if (!originalW || !originalH || originalW > 4096 || originalH > 4096) result = JDR_PAR;
		else {
			while (scale < 3 && ((originalW > originalH ? originalW : originalH) >> (scale + 1)) >= SIZE) scale++;
			t.width = originalW >> scale;
			t.height = originalH >> scale;
			if (!t.width || !t.height) result = JDR_PAR;
			else {
				uint32_t largest = t.width > t.height ? t.width : t.height;
				t.fitW = (t.width * SIZE + largest / 2) / largest;
				t.fitH = (t.height * SIZE + largest / 2) / largest;
				if (!t.fitW) t.fitW = 1;
				if (!t.fitH) t.fitH = 1;
				t.left = (SIZE - t.fitW) / 2;
				t.top = (SIZE - t.fitH) / 2;
				memset(t.pixels, 0, pixelBytes);
				result = jd_decomp(&jd, output, scale);
			}
		}
	}
	/* TJpgDec stops after the last MCU. Drain trailing bytes so the producer can reach HTTP EOF. */
	if (result == JDR_OK) {
		while (input(&jd, NULL, 512)) {}
		if (!load_state(&t, 2) || t.tail != 0xffd9) result = JDR_INP;
	}
	free(work);
	if (cancelled(&t)) xsUnknownError("Artwork cancelled or timed out");
	if (result != JDR_OK) xsUnknownError("JPEG decode failed (%d); baseline JPEG required", result);
	xsmcSetNewObject(xsResult);
	xsmcVars(1);
#define METRIC(name, value) xsmcSetNumber(xsVar(0), value); xsmcSet(xsResult, xsID(name), xsVar(0))
	METRIC("width", originalW);
	METRIC("height", originalH);
	METRIC("pixelFormat", kCommodettoBitmapFormat);
	METRIC("scale", 1 << scale);
	METRIC("bytes", t.consumed);
	METRIC("decodeMs", now_ms() - t.started - t.wait_ms);
	METRIC("waitMs", t.wait_ms);
	METRIC("workspaceBytes", WORK_BYTES + sizeof(JDEC) + sizeof(Thumbnail));
#if ESP32
	METRIC("minFreeHeap", t.minFreeHeap);
	METRIC("minFreeInternal", t.minFreeInternal);
	METRIC("freeHeap", heap_caps_get_free_size(MALLOC_CAP_8BIT));
	METRIC("freeInternal", heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
#endif
#undef METRIC
}

void xs_jpeg_memory_usage(xsMachine *the) {
	xsmcVars(1);
	xsmcSetNewObject(xsResult);
#if ESP32
	xsmcSetNumber(xsVar(0), heap_caps_get_free_size(MALLOC_CAP_8BIT));
	xsmcSet(xsResult, xsID("freeHeap"), xsVar(0));
	xsmcSetNumber(xsVar(0), heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
	xsmcSet(xsResult, xsID("freeInternal"), xsVar(0));
#endif
}

#if ESP32
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#if !CONFIG_ESP_HTTP_CLIENT_ENABLE_HTTPS
#error "JPEG HTTP producer requires CONFIG_ESP_HTTP_CLIENT_ENABLE_HTTPS=y"
#endif
#include <strings.h>
#include <stdio.h>

typedef struct {
	char type[80], encoding[40], location[2048];
	int badHeader;
} Headers;
static esp_err_t artwork_header(esp_http_client_event_t *event) {
	if (event->event_id != HTTP_EVENT_ON_HEADER) return ESP_OK;
	Headers *h = event->user_data;
	char *target = NULL;
	size_t capacity = 0;
	if (!strcasecmp(event->header_key, "content-type")) { target = h->type; capacity = sizeof(h->type); }
	else if (!strcasecmp(event->header_key, "content-encoding")) { target = h->encoding; capacity = sizeof(h->encoding); }
	else if (!strcasecmp(event->header_key, "location")) { target = h->location; capacity = sizeof(h->location); }
	if (target) {
		size_t n = strlen(event->header_value);
		if (n >= capacity) h->badHeader = 1;
		else memcpy(target, event->header_value, n + 1);
	}
	return ESP_OK;
}
#endif
void xs_jpeg_download(xsMachine *the) {
#if ESP32
	const char *url = xsmcToString(xsArg(0));
	if (strlen(url) > 2047 || (strncmp(url, "http://", 7) && strncmp(url, "https://", 8)))
		xsRangeError("Invalid artwork URL");
	Thumbnail t = {0};
	xsUnsignedValue dataBytes, stateBytes;
	xsmcGetBufferWritable(xsArg(1), (void **)&t.ring, &dataBytes);
	xsmcGetBufferWritable(xsArg(2), (void **)&t.state, &stateBytes);
	if (dataBytes < 512 || stateBytes != 16) xsRangeError("Invalid artwork ring");
	t.capacity = dataBytes;
	t.started = now_ms();
	Headers headers = {0};
	esp_http_client_config_t config = {
		.url = url,
		.timeout_ms = 5000,
		.buffer_size = 4096,
		.buffer_size_tx = 1024,
		.disable_auto_redirect = true,
		.event_handler = artwork_header,
		.user_data = &headers,
		.crt_bundle_attach = esp_crt_bundle_attach,
	};
	esp_http_client_handle_t client = esp_http_client_init(&config);
	if (!client) xsUnknownError("Artwork HTTP client initialization failed");
	uint8_t *buffer = malloc(4096);
	const char *error = NULL;
	char errorDetail[128];
	uint32_t received = 0, peakRingBytes = 0, firstByteMs = 0;
	int redirect = 0, status = 0;
	int64_t length = -1;
	if (!buffer) { error = "Artwork receive buffer allocation failed"; goto cleanup; }
	esp_http_client_set_header(client, "Accept-Encoding", "identity");
	esp_http_client_set_header(client, "Connection", "close");
	if (cancelled(&t)) { error = "Artwork cancelled"; goto cleanup; }
	esp_err_t connection = esp_http_client_open(client, 0);
	if (connection != ESP_OK) {
		int tlsCode = 0, tlsFlags = 0;
		esp_http_client_get_and_clear_last_tls_error(client, &tlsCode, &tlsFlags);
		snprintf(errorDetail, sizeof(errorDetail), "Artwork connection failed: %s; TLS %d flags %d", esp_err_to_name(connection), tlsCode, tlsFlags);
		error = errorDetail;
		goto cleanup;
	}
	length = esp_http_client_fetch_headers(client);
	if (length < 0 || headers.badHeader) { error = "Invalid artwork HTTP headers"; goto cleanup; }
	status = esp_http_client_get_status_code(client);
	if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
		if (!headers.location[0]) error = "Artwork redirect has no Location";
		else redirect = 1;
		goto cleanup;
	}
	if (status != 200) { error = "Artwork HTTP response rejected"; goto cleanup; }
	if (length > 2 * 1024 * 1024) { error = "Artwork exceeds 2 MiB limit"; goto cleanup; }
	if (headers.encoding[0] && strcasecmp(headers.encoding, "identity")) { error = "Compressed artwork HTTP response"; goto cleanup; }
	char *semicolon = strchr(headers.type, ';');
	if (semicolon) *semicolon = 0;
	size_t typeLength = strlen(headers.type);
	while (typeLength && headers.type[typeLength - 1] == ' ') headers.type[--typeLength] = 0;
	if (headers.type[0] && strcasecmp(headers.type, "image/jpeg") && strcasecmp(headers.type, "image/jpg") &&
		strcasecmp(headers.type, "application/octet-stream") && strcasecmp(headers.type, "binary/octet-stream")) {
		error = "JPEG artwork required"; goto cleanup;
	}
	for (;;) {
		if (cancelled(&t)) { error = "Artwork cancelled"; goto cleanup; }
		int count = esp_http_client_read(client, (char *)buffer, 4096);
		if (count < 0) { error = "Artwork HTTP read failed"; goto cleanup; }
		if (!count) {
			if (!esp_http_client_is_complete_data_received(client) || (length > 0 && received != length))
				error = "Incomplete artwork HTTP response";
			break;
		}
		if (!received) firstByteMs = now_ms() - t.started;
		if (received + count > 2 * 1024 * 1024) { error = "Artwork exceeds 2 MiB limit"; goto cleanup; }
		uint32_t offset = 0;
		while (offset < (uint32_t)count) {
			if (cancelled(&t)) { error = "Artwork cancelled"; goto cleanup; }
			uint32_t write = load_state(&t, 0), used = write - load_state(&t, 1);
			if (used > t.capacity) { error = "Invalid artwork ring state"; goto cleanup; }
			if (used == t.capacity) { yield_decoder(); continue; }
			uint32_t n = t.capacity - (write % t.capacity);
			if (n > t.capacity - used) n = t.capacity - used;
			if (n > (uint32_t)count - offset) n = count - offset;
			memcpy(t.ring + write % t.capacity, buffer + offset, n);
			__atomic_store_n(t.state, write + n, __ATOMIC_RELEASE);
			offset += n;
			if (used + n > peakRingBytes) peakRingBytes = used + n;
		}
		received += count;
	}
cleanup:
	esp_http_client_cleanup(client);
	free(buffer);
	if (error) xsUnknownError("%s (HTTP %d)", error, status);
	xsmcVars(1);
	xsmcSetNewObject(xsResult);
	if (redirect) {
		xsmcSetString(xsVar(0), headers.location);
		xsmcSet(xsResult, xsID("redirect"), xsVar(0));
		return;
	}
	__atomic_store_n(t.state + 2, 1, __ATOMIC_RELEASE);
#define METRIC(name, value) xsmcSetNumber(xsVar(0), value); xsmcSet(xsResult, xsID(name), xsVar(0))
	METRIC("bytes", received);
	METRIC("downloadMs", now_ms() - t.started);
	METRIC("firstByteMs", firstByteMs);
	METRIC("peakRingBytes", peakRingBytes);
#undef METRIC
#else
	xsUnknownError("Native artwork HTTP requires ESP32-S3");
#endif
}

#if ESP32 && defined(mxInstrument)
#include "xsHosts.h"
static void thumbnail_no_sample(modTimer timer, void *refcon, int size) {}
#endif
void xs_jpeg_prepare_worker(xsMachine *the) {
#if ESP32 && defined(mxInstrument)
	/* worker.terminate() deletes the FreeRTOS task. Sampling may hold the SDK's global
	 * instrumentation mutex, so stop its timer on this task before native work/replies.
	 * Heap and timing measurements above remain available without periodic sampling. */
	modInstrumentMachineEnd(the);
	/* Retain a valid timer/onBreak pair so debugger pause/resume remains usable. */
	modInstrumentMachineBegin(the, thumbnail_no_sample, 0, NULL, NULL);
#endif
}
