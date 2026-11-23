#ifndef STACKCHAN_SANO_RESAMPLER_H
#define STACKCHAN_SANO_RESAMPLER_H
#include <stdint.h>

/* 22050 -> 24000 Hz, ratio 160/147. Position is measured in 1/160 input
 * samples. Carry phase and previous sample across every upstream pull; flush
 * once with the final sample held. Produces ceil(N * 160 / 147) samples. */
#define SANO_RESAMPLED_CHUNK 2232u
typedef struct { int16_t previous; uint16_t phase; uint8_t primed; } sano_resampler;
static inline unsigned sano_resample_sample(sano_resampler *r, int16_t sample, int16_t *out) {
    if (!r->primed) { r->previous = sample; r->phase = 0; r->primed = 1; return 0; }
    unsigned count = 0;
    while (r->phase < 160) {
        out[count++] = (int16_t)(((int32_t)r->previous * (160 - r->phase) + (int32_t)sample * r->phase) / 160);
        r->phase += 147;
    }
    r->phase -= 160;
    r->previous = sample;
    return count;
}
static inline unsigned sano_resample_flush(sano_resampler *r, int16_t *out) {
    if (!r->primed) return 0;
    unsigned count = sano_resample_sample(r, r->previous, out);
    r->primed = 0;
    r->phase = 0;
    r->previous = 0;
    return count;
}
#endif
