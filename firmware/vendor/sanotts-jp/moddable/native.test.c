#include "pcm-queue.h"
#include "resampler.h"
#include "saanotts.h"
#include "saanotts_stream.h"
#include "saan_pcm.h"
#include "g2p.h"
#include "model-format.h"
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
#include <pthread.h>

static const uint8_t *model_bytes;
static size_t model_size;
static void *model_allocation;

/* Tests consume the downloaded local asset at runtime, just as the firmware
 * now consumes a separate partition. No generated C model array is needed. */
static int load_model(const char *path) {
    FILE *file = fopen(path, "rb");
    if (!file) {
        fputs("local sanoTTS model file required; run scripts/fetch-sanotts-model.mjs first\n", stderr);
        return 0;
    }
    if (fseek(file, 0, SEEK_END) || ftell(file) != SANO_MODEL_BYTES || fseek(file, 0, SEEK_SET)) {
        fclose(file);
        fputs("local sanoTTS model has the wrong length\n", stderr);
        return 0;
    }
    model_size = SANO_MODEL_BYTES;
    model_allocation = malloc(model_size + 15u);
    if (!model_allocation) { fclose(file); return 0; }
    uint8_t *aligned = (uint8_t *)(((uintptr_t)model_allocation + 15u) & ~(uintptr_t)15u);
    size_t read_bytes = fread(aligned, 1, model_size, file);
    fclose(file);
    if (read_bytes != model_size) {
        free(model_allocation);
        model_allocation = NULL;
        fputs("local sanoTTS model read failed\n", stderr);
        return 0;
    }
    model_bytes = aligned;
    return 1;
}

static sano_queue queue;
static void *producer(void *unused) {
    (void)unused;
    int16_t batch[237];
    for (uint32_t base = 0; base < 1000000;) {
        uint32_t count = 1000000 - base;
        if (count > 237) count = 237;
        for (uint32_t i = 0; i < count; i++) batch[i] = (int16_t)(base + i);
        if (sano_queue_put(&queue, batch, count)) base += count;
    }
    return NULL;
}
static void test_queue(void) {
    queue.samples = calloc(SANO_QUEUE_SAMPLES, 2);
    int16_t block[SANO_QUEUE_SAMPLES], out[2046];
    for (unsigned i = 0; i < SANO_QUEUE_SAMPLES; i++) block[i] = (int16_t)i;
    assert(sano_queue_put(&queue, block, SANO_QUEUE_SAMPLES));
    assert(!sano_queue_put(&queue, block, 1));
    assert(sano_queue_read(&queue, block, SANO_QUEUE_SAMPLES) == SANO_QUEUE_SAMPLES);
    assert(!sano_queue_read(&queue, out, 2046));
    /* Exercise unsigned counter wrap as well as ring wrap. */
    queue.read = queue.written = UINT32_MAX - 8191;
    pthread_t thread;
    assert(!pthread_create(&thread, NULL, producer, NULL));
    for (uint32_t base = 0; base < 1000000;) {
        uint32_t count = sano_queue_read(&queue, out, 2046);
        for (uint32_t i = 0; i < count; i++) assert(out[i] == (int16_t)(base + i));
        base += count;
    }
    pthread_join(thread, NULL);
    assert(!sano_queue_available(&queue));
    free(queue.samples);
}
static void test_core(const char *text) {
    int32_t ids[350], count = 0;
    saan_g2p_info info;
    assert(saan_g2p(text, strlen(text), ids, 350, &count, &info) == SAAN_G2P_OK);
    saan_weights weights;
    assert(saan_weights_open(&weights, model_bytes, model_size) == SAAN_OK);
    size_t needed = saan_stream_arena_peak(count);
    void *memory = malloc(needed);
    saan_arena arena;
    saan_arena_init(&arena, memory, needed);
    saan_stream stream;
    assert(saan_stream_init(&stream, &weights, &arena, ids, count, SAAN_S_V) == SAAN_OK);
    assert(arena.used == saan_stream_arena_used(count));
    saan_pcm_reset();
    int32_t frames;
    const float *pcm;
    sano_resampler resampler = {0};
    uint32_t outputSamples = 0;
    uint64_t outputHash = 1469598103934665603ull;
    do {
        assert(saan_stream_pull_ptr(&stream, &pcm, &frames) == SAAN_OK);
        assert(frames >= 0 && frames <= SAAN_CHUNK);
        for (int32_t i = 0; i < frames * SAAN_HOP; i++) {
            int16_t output[2];
            unsigned n = sano_resample_sample(&resampler, saan_f32_to_i16(pcm[i]), output);
            for (unsigned j = 0; j < n; j++) {
                uint16_t bits = (uint16_t)output[j];
                outputHash = (outputHash ^ (uint8_t)bits) * 1099511628211ull;
                outputHash = (outputHash ^ (uint8_t)(bits >> 8)) * 1099511628211ull;
            }
            outputSamples += n;
        }
    } while (frames);
    int16_t tail[2];
    unsigned nTail = sano_resample_flush(&resampler, tail);
    for (unsigned j = 0; j < nTail; j++) {
        uint16_t bits = (uint16_t)tail[j];
        outputHash = (outputHash ^ (uint8_t)bits) * 1099511628211ull;
        outputHash = (outputHash ^ (uint8_t)(bits >> 8)) * 1099511628211ull;
    }
    outputSamples += nTail;
    assert(arena.peak <= needed);
    assert(saan_pcm_samples() == (uint32_t)stream.n_frames * SAAN_HOP);
    uint64_t hash = saan_pcm_checksum();
    uint32_t samples = saan_pcm_samples();
    /* Independent copy API must yield the same PCM as ptr API. */
    saan_arena_reset(&arena);
    assert(saan_stream_init(&stream, &weights, &arena, ids, count, SAAN_S_V) == SAAN_OK);
    float copy[SAAN_CHUNK * SAAN_HOP];
    saan_pcm_reset();
    do {
        assert(saan_stream_pull(&stream, copy, &frames) == SAAN_OK);
        for (int32_t i = 0; i < frames * SAAN_HOP; i++) (void)saan_f32_to_i16(copy[i]);
    } while (frames);
    assert(samples == saan_pcm_samples() && hash == saan_pcm_checksum());
    assert(outputSamples == (samples * 160u + 146u) / 147u);
    printf("PCM ids=%ld samples=%u hash=%016llx outputSamples=%u outputHash=%016llx arena=%zu/%zu\n",
        (long)count, samples, (unsigned long long)hash, outputSamples, (unsigned long long)outputHash, arena.peak, needed);
    free(memory);
}
static void test_resampler(unsigned inputCount) {
    sano_resampler r = {0};
    unsigned capacity = (inputCount * 160u + 146u) / 147u;
    int16_t *output = calloc(capacity, 2);
    unsigned count = 0;
    for (unsigned i = 0; i < inputCount; i++)
        count += sano_resample_sample(&r, (int16_t)((int)(i % 1000) - 500), output + count);
    count += sano_resample_flush(&r, output + count);
    assert(count == capacity);
    assert(sano_resample_flush(&r, output) == 0);
    for (unsigned m = 0; m < count; m++) {
        unsigned index = m * 147u / 160u;
        int32_t phase = (int32_t)(m * 147u % 160u);
        unsigned next = index + 1 < inputCount ? index + 1 : index;
        int32_t a = (int)(index % 1000) - 500, b = (int)(next % 1000) - 500;
        assert(output[m] == (a * (160 - phase) + b * phase) / 160);
    }
    free(output);
}
int main(int argc, char **argv) {
    if (argc != 2) { fputs("usage: sanotts-test <local-model.bin>\n", stderr); return 2; }
    if (!load_model(argv[1])) return 2;
    test_queue();
    for (unsigned n = 1; n <= 4097; n++) test_resampler(n);
    test_resampler(14848);
    int32_t ids[350], count;
    saan_g2p_info info;
    assert(saan_g2p("漢字", strlen("漢字"), ids, 350, &count, &info) == SAAN_G2P_ERR_UNKNOWN);
    assert(saan_g2p("\xff", 1, ids, 350, &count, &info) == SAAN_G2P_ERR_UTF8);
    char tooLong[1024]; memset(tooLong, '[', sizeof(tooLong));
    assert(saan_g2p(tooLong, sizeof(tooLong), ids, 350, &count, &info) == SAAN_G2P_ERR_OVERFLOW);
    test_core("こんにちわ");
    /* Same unaccented intermediate input as the device probe: these print
     * independent desktop count/hash evidence for both source and output PCM. */
    test_core("こんにちは");
    test_core("こんにちは#きょおわいいてんきですね#すたっくちゃんです#"
        "こんにちは#きょおわいいてんきですね#すたっくちゃんです#"
        "こんにちは#きょおわいいてんきですね#すたっくちゃんです#");
    test_core("きょ][おわよ][いて][んきです°ね#こんにちわ#すたっくちゃんです");
    free(model_allocation);
    puts("native queue/backpressure/wrap/concurrent PCM/resampler/core/invalid-input checks passed");
}
