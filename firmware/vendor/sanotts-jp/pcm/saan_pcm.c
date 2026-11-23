#include "saan_pcm.h"

#include <math.h>

/* ⚠️ **リトルエンディアンの 2 バイトを順に食う。** ホスト（esp32/host_stub）と
 *    ターゲットで同じ順序・同じ幅でないと比較が無意味になる。 */
#define FNV_OFFSET 1469598103934665603ull
#define FNV_PRIME  1099511628211ull

static uint32_t s_clips;
static uint64_t s_pcm_fnv = FNV_OFFSET;
static uint32_t s_pcm_n;
static int32_t  s_pcm_absmax;
static uint64_t s_pcm_sqsum;

int16_t saan_f32_to_i16(float x) {
    long v = lrintf(x * 32767.0f);
    if (v > 32767) { v = 32767; ++s_clips; }
    else if (v < -32768) { v = -32768; ++s_clips; }
    uint16_t u = (uint16_t)(int16_t)v;
    s_pcm_fnv = (s_pcm_fnv ^ (uint8_t)(u & 0xff)) * FNV_PRIME;
    s_pcm_fnv = (s_pcm_fnv ^ (uint8_t)(u >> 8)) * FNV_PRIME;
    { int32_t av = (int32_t)(v < 0 ? -v : v);
      if (av > s_pcm_absmax) s_pcm_absmax = av;
      s_pcm_sqsum += (uint64_t)((int64_t)v * (int64_t)v); }
    ++s_pcm_n;
    return (int16_t)v;
}

void saan_pcm_reset(void) {
    s_pcm_fnv = FNV_OFFSET;
    s_pcm_n = 0;
    s_pcm_absmax = 0;
    s_pcm_sqsum = 0;
    s_clips = 0;
}

uint32_t saan_pcm_clip_count(void) { return s_clips; }
uint64_t saan_pcm_checksum(void)   { return s_pcm_fnv; }
uint32_t saan_pcm_samples(void)    { return s_pcm_n; }
int32_t  saan_pcm_absmax(void)     { return s_pcm_absmax; }
uint64_t saan_pcm_sqsum(void)      { return s_pcm_sqsum; }
