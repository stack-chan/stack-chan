#ifndef STACKCHAN_SANO_PCM_QUEUE_H
#define STACKCHAN_SANO_PCM_QUEUE_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* One producer (native task), one consumer (XS). Counters publish complete PCM
 * copies using acquire/release. No locks, allocations or inference in read. */
#define SANO_QUEUE_SAMPLES 16384u
typedef struct {
    int16_t *samples;
    uint32_t read;
    uint32_t written;
} sano_queue;

static inline uint32_t sano_queue_available(const sano_queue *q) {
    uint32_t begin, end, verified;
    /* Also safe for a third-party XS observer while both native producer and
     * consumer advance. Never subtract a new read from an older write. */
    do {
        begin = __atomic_load_n(&q->read, __ATOMIC_ACQUIRE);
        end = __atomic_load_n(&q->written, __ATOMIC_ACQUIRE);
        verified = __atomic_load_n(&q->read, __ATOMIC_ACQUIRE);
    } while (begin != verified);
    return end - begin;
}
static inline int sano_queue_put(sano_queue *q, const int16_t *src, uint32_t count) {
    uint32_t end = __atomic_load_n(&q->written, __ATOMIC_RELAXED);
    uint32_t begin = __atomic_load_n(&q->read, __ATOMIC_ACQUIRE);
    if (count > SANO_QUEUE_SAMPLES - (end - begin)) return 0;
    uint32_t offset = end % SANO_QUEUE_SAMPLES;
    uint32_t first = SANO_QUEUE_SAMPLES - offset;
    if (first > count) first = count;
    memcpy(q->samples + offset, src, first * sizeof(*src));
    if (count > first) memcpy(q->samples, src + first, (count - first) * sizeof(*src));
    __atomic_store_n(&q->written, end + count, __ATOMIC_RELEASE);
    return 1;
}
static inline uint32_t sano_queue_read(sano_queue *q, int16_t *dst, uint32_t capacity) {
    uint32_t begin = __atomic_load_n(&q->read, __ATOMIC_RELAXED);
    uint32_t count = __atomic_load_n(&q->written, __ATOMIC_ACQUIRE) - begin;
    if (count > capacity) count = capacity;
    if (!count) return 0;
    uint32_t offset = begin % SANO_QUEUE_SAMPLES;
    uint32_t first = SANO_QUEUE_SAMPLES - offset;
    if (first > count) first = count;
    memcpy(dst, q->samples + offset, first * sizeof(*dst));
    if (count > first) memcpy(dst + first, q->samples, (count - first) * sizeof(*dst));
    __atomic_store_n(&q->read, begin + count, __ATOMIC_RELEASE);
    return count;
}
#endif
