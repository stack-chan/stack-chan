/* Independent observable-behavior checks for the 22050 -> 24000 adapter.
 * No XS/ESP-IDF, model, USB, or generated asset is needed. */
#include "resampler.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t output_length(size_t count) { return (count * 160 + 146) / 147; }

/* The public per-sample/flush API requires room for at most TWO int16s.
 * Canaries catch writes outside the smallest supported destination. */
static unsigned push(sano_resampler *state, int16_t sample, int16_t *output, int flush) {
    int16_t guarded[4] = {12345, -2345, -2345, 23456};
    unsigned count = flush ? sano_resample_flush(state, guarded + 1)
                           : sano_resample_sample(state, sample, guarded + 1);
    assert(count <= 2);
    assert(guarded[0] == 12345 && guarded[3] == 23456);
    for (unsigned i = count; i < 2; ++i) assert(guarded[i + 1] == -2345);
    memcpy(output, guarded + 1, count * sizeof(int16_t));
    return count;
}

static size_t convert(const int16_t *input, size_t count, const unsigned *partitions,
                      size_t n_partitions, int16_t *output) {
    sano_resampler state = {0};
    size_t position = 0, produced = 0, part = 0;
    while (position < count) {
        size_t chunk = partitions[part++ % n_partitions];
        assert(chunk > 0);
        if (chunk > count - position) chunk = count - position;
        size_t chunk_begin = produced;
        for (size_t j = 0; j < chunk; ++j)
            produced += push(&state, input[position++], output + produced, 0);
        if (chunk <= 2048) assert(produced - chunk_begin <= SANO_RESAMPLED_CHUNK);
        /* Input chunk boundaries are NOT an EOS; do not flush/reset here. */
    }
    produced += push(&state, 0, output + produced, 1);
    assert(push(&state, 0, output + produced, 1) == 0);
    assert(produced == output_length(count));
    return produced;
}

static void lengths_and_partition_invariance(void) {
    const size_t capacity = 32769;
    int16_t *input = malloc(capacity * sizeof(int16_t));
    int16_t *reference = malloc((output_length(capacity) + 2) * sizeof(int16_t));
    int16_t *actual = malloc((output_length(capacity) + 2) * sizeof(int16_t));
    assert(input && reference && actual);
    uint32_t random = 0x39ac42;
    for (size_t i = 0; i < capacity; ++i) {
        random ^= random << 13; random ^= random >> 17; random ^= random << 5;
        input[i] = (int16_t)(random & 65535u);
    }
    const unsigned whole[] = {32769}, singles[] = {1}, upstream[] = {2048};
    const unsigned uneven[] = {1, 147, 2, 2047, 160, 3, 4093, 17};
    const size_t lengths[] = {0, 1, 2, 3, 146, 147, 148, 159, 160, 161, 2047, 2048, 2049, 32769};
    for (size_t k = 0; k < sizeof(lengths) / sizeof(*lengths); ++k) {
        size_t n = lengths[k];
        size_t out = convert(input, n, whole, 1, reference);
        assert(convert(input, n, singles, 1, actual) == out);
        assert(memcmp(reference, actual, out * sizeof(int16_t)) == 0);
        assert(convert(input, n, upstream, 1, actual) == out);
        assert(memcmp(reference, actual, out * sizeof(int16_t)) == 0);
        assert(convert(input, n, uneven, 8, actual) == out);
        assert(memcmp(reference, actual, out * sizeof(int16_t)) == 0);
    }
    free(actual); free(reference); free(input);
    puts("PASS partition invariance, rational lengths, shortest guarded destinations");
}

static void silence_dc_and_endpoints(void) {
    const int16_t values[] = {0, 1, -1, 12345, -12345, INT16_MIN, INT16_MAX};
    const unsigned chunks[] = {1, 11, 147, 2048};
    int16_t input[2049], output[2232];
    for (size_t k = 0; k < sizeof(values) / sizeof(*values); ++k) {
        for (size_t j = 0; j < 2049; ++j) input[j] = values[k];
        size_t count = convert(input, 2049, chunks, 4, output);
        for (size_t j = 0; j < count; ++j) assert(output[j] == values[k]);
    }
    sano_resampler state = {0};
    int16_t out[2];
    assert(push(&state, 0, out, 1) == 0); /* empty EOS */
    assert(push(&state, -12345, out, 0) == 0); /* first sample waits for lookahead */
    assert(push(&state, 0, out, 1) == 2);
    assert(out[0] == -12345 && out[1] == -12345); /* EOS holds, never appends silence */
    assert(push(&state, 0, out, 1) == 0);
    puts("PASS silence/DC/extrema preservation, empty/single-sample EOS, idempotent flush");
}

static void waveform_and_restart(void) {
    const double pi = 3.14159265358979323846;
    int16_t input[22050], output[24002], restarted[24002];
    for (size_t i = 0; i < 22050; ++i)
        input[i] = (int16_t)lrint(12000 * sin(2 * pi * 440 * i / 22050));
    const unsigned chunks[] = {2048, 1, 147, 3};
    assert(convert(input, 22050, chunks, 4, output) == 24000);
    for (size_t i = 0; i + 2 < 24000; ++i) {
        double ideal = 12000 * sin(2 * pi * 440 * i / 24000);
        assert(fabs(output[i] - ideal) < 26); /* interpolation + int16 rounding error */
    }
    /* Cancellation discards state. Each native utterance gets a zeroed owner. */
    sano_resampler cancelled = {0};
    int16_t scratch[2];
    for (size_t i = 0; i < 17; ++i) push(&cancelled, INT16_MIN, scratch, 0);
    cancelled = (sano_resampler){0};
    size_t count = 0;
    for (size_t i = 0; i < 22050; ++i)
        count += push(&cancelled, input[i], restarted + count, 0);
    count += push(&cancelled, 0, restarted + count, 1);
    assert(count == 24000 && memcmp(restarted, output, count * sizeof(int16_t)) == 0);
    /* Flush resets the public helper for a new, independent utterance. */
    sano_resampler reusable = {0};
    const size_t completed_lengths[] = {1, 2, 148, 2049, 22049};
    for (unsigned utterance = 0; utterance < 5; ++utterance) {
        size_t length = completed_lengths[utterance];
        size_t expected_count = convert(input, length, chunks, 4, output);
        count = 0;
        for (size_t i = 0; i < length; ++i)
            count += push(&reusable, input[i], restarted + count, 0);
        count += push(&reusable, 0, restarted + count, 1);
        assert(count == expected_count && memcmp(restarted, output, count * sizeof(int16_t)) == 0);
    }
    puts("PASS 440 Hz waveform/duration, cancelled-owner reset, repeated utterances");
}

int main(void) {
    lengths_and_partition_invariance();
    silence_dc_and_endpoints();
    waveform_and_restart();
    return 0;
}
