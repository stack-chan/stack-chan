/* One native task owns upstream inference/PCM state. XS only copies the SPSC
 * queue. No task calls XS; the provider polls with Timer. close joins before
 * freeing memory, including on cancellation, failure and VM destruction. */
#include "xsmc.h"
#include "xsHost.h"
#include "saanotts.h"
#include "saanotts_stream.h"
#include "g2p.h"
#include "saan_pcm.h"
#include "pcm-queue.h"
#include "resampler.h"

#include "model-storage.h"
#include "esp_heap_caps.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if !defined(CONFIG_IDF_TARGET_ESP32S3) || !CONFIG_IDF_TARGET_ESP32S3
#error "sanoTTS requires the opt-in CoreS3 build"
#endif
#define SANO_MAX_BYTES 512
#define SANO_MAX_IDS 350
#define SANO_INTERNAL_RESERVE (64u * 1024u)
_Static_assert(SANO_RESAMPLED_CHUNK >= (SAAN_CHUNK * SAAN_HOP * 160u + 146u) / 147u + 2u, "resampled chunk capacity");
enum { SANO_IDLE, SANO_RUNNING, SANO_DONE, SANO_ERROR, SANO_CLOSED };
typedef struct {
    SanoModel model;
    uint32_t modelClaimed;
    sano_queue queue;
    SemaphoreHandle_t joined;
    TaskHandle_t task;
    uint32_t state, closing, started;
    char text[SANO_MAX_BYTES + 1], error[128];
} SanoRecord;
#define LOAD(p) __atomic_load_n(&(p), __ATOMIC_ACQUIRE)
#define STORE(p, v) __atomic_store_n(&(p), (v), __ATOMIC_RELEASE)
static void sano_error(SanoRecord *r, const char *text) {
    snprintf(r->error, sizeof(r->error), "%s", text);
}
static void sano_worker(void *refcon) {
    SanoRecord *r = refcon;
    int32_t ids[SANO_MAX_IDS], nIds = 0;
    saan_g2p_info info;
    saan_weights weights;
    saan_arena arena;
    saan_stream stream;
    void *arenaMemory = NULL;
    int16_t *chunk = NULL;
    sano_resampler resampler = {0};

    int failed = 0;
    uint32_t initialFree = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    uint32_t initialLargest = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);

    if (saan_g2p(r->text, strlen(r->text), ids, SANO_MAX_IDS, &nIds, &info) != SAAN_G2P_OK) {
        snprintf(r->error, sizeof(r->error), "invalid kana or too many ids (byte %ld, max %d ids)", (long)info.err_byte, SANO_MAX_IDS);
        failed = 1; goto finish;
    }
    if (!sano_model_open_claimed(&r->model, r->error, sizeof(r->error))) {
        failed = 1; goto finish;
    }
    if (LOAD(r->closing)) goto finish;
    if (saan_weights_open(&weights, r->model.payload, SANO_MODEL_BYTES) != SAAN_OK) {
        sano_error(r, "invalid sanoTTS model"); failed = 1; goto finish;
    }
    size_t needed = saan_stream_arena_peak(nIds);

    if (initialLargest >= needed && initialFree >= needed + SANO_INTERNAL_RESERVE) {
        arenaMemory = heap_caps_aligned_alloc(16, needed, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
    if (!arenaMemory)
        arenaMemory = heap_caps_aligned_alloc(16, needed, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    r->queue.samples = heap_caps_malloc(SANO_QUEUE_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    chunk = heap_caps_malloc(SANO_RESAMPLED_CHUNK * sizeof(int16_t), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (!arenaMemory || !r->queue.samples || !chunk) {
        sano_error(r, "sanoTTS allocation failed"); failed = 1; goto finish;
    }
    saan_arena_init(&arena, arenaMemory, needed);
    saan_pcm_reset();

    saan_status result = saan_stream_init(&stream, &weights, &arena, ids, nIds, SAAN_S_V);

    if (result != SAAN_OK || arena.failed || arena.used != saan_stream_arena_used(nIds)) {
        sano_error(r, result == SAAN_OK ? "sanoTTS arena invariant failed" : saan_strerror(result));
        failed = 1; goto finish;
    }
    while (!LOAD(r->closing)) {
        /* Reserve capacity BEFORE pulling. Returned floats are copied through
         * the official int16 conversion before their next-pull expiry. */
        while (sano_queue_available(&r->queue) > SANO_QUEUE_SAMPLES - SANO_RESAMPLED_CHUNK) {
            if (LOAD(r->closing)) goto synthesis_finished;
            vTaskDelay(1);
        }
        const float *pcm = NULL;
        int32_t frames = 0;
        result = saan_stream_pull_ptr(&stream, &pcm, &frames);

        if (result != SAAN_OK || frames < 0 || frames > SAAN_CHUNK || (frames && !pcm)) {
            sano_error(r, result == SAAN_OK ? "invalid sanoTTS PCM frame count" : saan_strerror(result));
            failed = 1; break;
        }
        if (!frames) {
            unsigned tail = sano_resample_flush(&resampler, chunk);
            if (!LOAD(r->closing) && tail && !sano_queue_put(&r->queue, chunk, tail)) {
                sano_error(r, "sanoTTS resampler flush overflow"); failed = 1;
            }
            break;
        }
        uint32_t count = (uint32_t)frames * SAAN_HOP; /* n_out is FRAMES */
        unsigned outputCount = 0;
        for (uint32_t i = 0; i < count; ++i)
            outputCount += sano_resample_sample(&resampler, saan_f32_to_i16(pcm[i]), chunk + outputCount);
        if (LOAD(r->closing)) break;
        if (outputCount > SANO_RESAMPLED_CHUNK || !sano_queue_put(&r->queue, chunk, outputCount)) {
            sano_error(r, "sanoTTS queue invariant failed"); failed = 1; break;
        }
        vTaskDelay(1);
    }
synthesis_finished:
finish:
    heap_caps_free(chunk);
    heap_caps_free(arenaMemory);
    STORE(r->state, LOAD(r->closing) ? SANO_CLOSED : failed ? SANO_ERROR : SANO_DONE);
    /* Owner waits for actual suspension, then deletes the task and its stack.
     * A notification alone is not a completed task lifetime. */
    SemaphoreHandle_t joined = r->joined;
    xSemaphoreGive(joined);
    for (;;) vTaskSuspend(NULL);
}
void xs_sano_destructor(void *data) {
    SanoRecord *r = data;
    if (!r) return;
    STORE(r->closing, 1);
    if (r->started) {
        xSemaphoreTake(r->joined, portMAX_DELAY);
        while (eTaskGetState(r->task) != eSuspended) vTaskDelay(1);
        vTaskDelete(r->task);
    }
    if (r->modelClaimed) sano_model_release(&r->model);
    if (r->joined) vSemaphoreDelete(r->joined);
    heap_caps_free(r->queue.samples);
    free(r);
}
static SanoRecord *sano_get(xsMachine *the) {
    SanoRecord *r = xsmcGetHostDataValidate(xsThis, xs_sano_destructor);
    if (!r) xsUnknownError("sanoTTS closed");
    return r;
}
void xs_sano_constructor(xsMachine *the) {
    SanoRecord *r = calloc(1, sizeof(SanoRecord));
    if (!r) xsUnknownError("sanoTTS no memory");

    r->joined = xSemaphoreCreateBinary();
    if (!r->joined) { free(r); xsUnknownError("sanoTTS no semaphore"); }
    xsmcSetHostData(xsThis, r);
}
void xs_sano_start(xsMachine *the) {
    /* Do not coerce user objects after obtaining host data: a toString hook
     * could re-enter close/start and invalidate the record. */
    if (xsmcArgc != 1 || xsmcTypeOf(xsArg(0)) != xsStringType) xsTypeError("sanoTTS kana must be a string");
    SanoRecord *r = sano_get(the);
    if (LOAD(r->state) != SANO_IDLE) xsUnknownError("sanoTTS start is single use");
    const char *text = xsmcToString(xsArg(0));
    size_t size = strlen(text);
    if (!size || size > SANO_MAX_BYTES) xsRangeError("sanoTTS expects 1..512 UTF-8 bytes of kana intermediate text");
    if (!sano_model_claim()) {
        xsUnknownError("sanoTTS model is in use");
    }
    r->modelClaimed = 1;
    memcpy(r->text, text, size + 1);
    int workerCore = xPortGetCoreID();
#if !CONFIG_FREERTOS_UNICORE
    workerCore ^= 1;
#endif
    STORE(r->state, SANO_RUNNING);
    if (pdPASS != xTaskCreatePinnedToCore(sano_worker, "sanoTTS", 12288, r, 1, &r->task, workerCore)) {
        sano_model_release(&r->model);
        r->modelClaimed = 0;
        sano_error(r, "sanoTTS task allocation failed");
        STORE(r->state, SANO_ERROR);
        xsUnknownError("sanoTTS task allocation failed");
    }
    r->started = 1;
}
void xs_sano_close(xsMachine *the) {
    SanoRecord *r = xsmcGetHostDataValidate(xsThis, xs_sano_destructor);
    if (!r) return;
    xsmcSetHostData(xsThis, NULL);
    xs_sano_destructor(r);
}
void xs_sano_read(xsMachine *the) {
    SanoRecord *r = sano_get(the);
    void *buffer;
    xsUnsignedValue bytes;
    xsmcGetBufferWritable(xsArg(0), &buffer, &bytes);
    if (!bytes || (bytes & 1) || ((uintptr_t)buffer & 1)) xsRangeError("sanoTTS read expects aligned nonempty int16 PCM buffer");
    uint32_t state = LOAD(r->state);
    if (state == SANO_ERROR) xsUnknownError("%s", r->error);
    uint32_t count = sano_queue_read(&r->queue, buffer, bytes / sizeof(int16_t));
    if (count) { xsmcSetInteger(xsResult, count); return; }
    xsmcSetInteger(xsResult, state == SANO_DONE ? -1 : 0);
}
void xs_sano_available(xsMachine *the) {
    SanoRecord *r = sano_get(the);
    xsmcSetInteger(xsResult, sano_queue_available(&r->queue));
}
void xs_sano_done(xsMachine *the) {
    SanoRecord *r = sano_get(the);
    uint32_t state = LOAD(r->state);
    xsmcSetBoolean(xsResult, state != SANO_RUNNING);
}
void xs_sano_stop(xsMachine *the) {
    SanoRecord *r = sano_get(the);
    STORE(r->closing, 1);
}
