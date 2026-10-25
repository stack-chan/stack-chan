#pragma once
#include <stdint.h>
typedef struct {
  unsigned references, pending;
  uint8_t closed, failed;
} MuseLifetime;
static inline int muse_event_hold(MuseLifetime *l) {
  if (__atomic_load_n(&l->closed, __ATOMIC_SEQ_CST)) return 0;
  if (__atomic_add_fetch(&l->pending, 1, __ATOMIC_SEQ_CST) > 4) {
    __atomic_sub_fetch(&l->pending, 1, __ATOMIC_SEQ_CST);
    __atomic_store_n(&l->failed, 1, __ATOMIC_SEQ_CST);
    return 0;
  }
  __atomic_add_fetch(&l->references, 1, __ATOMIC_SEQ_CST);
  return 1;
}
static inline int muse_event_begin(MuseLifetime *l) {
  __atomic_sub_fetch(&l->pending, 1, __ATOMIC_SEQ_CST);
  return !__atomic_load_n(&l->closed, __ATOMIC_SEQ_CST);
}
static inline int muse_owner_close(MuseLifetime *l) {
  return !__atomic_exchange_n(&l->closed, 1, __ATOMIC_SEQ_CST);
}
static inline int muse_event_release(MuseLifetime *l) {
  return !__atomic_sub_fetch(&l->references, 1, __ATOMIC_SEQ_CST);
}
