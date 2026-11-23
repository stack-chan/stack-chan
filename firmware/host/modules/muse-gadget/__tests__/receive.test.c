#include "../native/receive.h"
#include "../native/lifetime.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
  MuseLifetime life = {.references = 1};
  for (int i = 0; i < MUSE_PENDING_MAX; i++) assert(muse_event_hold(&life));
  assert(!muse_event_hold(&life) && life.failed);
  assert(life.pending == MUSE_PENDING_MAX && life.references == MUSE_PENDING_MAX + 1);
  assert(muse_owner_close(&life));
  assert(!muse_owner_close(&life));
  assert(!muse_event_hold(&life));
  assert(!muse_event_release(&life)); /* owner joined task; queued events survive */
  for (int i = 0; i < MUSE_PENDING_MAX; i++) {
    assert(!muse_event_begin(&life)); /* never call XS after close */
    assert(muse_event_release(&life) == (i == MUSE_PENDING_MAX - 1));
  }
  assert(life.pending == 0 && life.references == 0);
  MuseReceive r = {0};
  char borrowed[] = "abc";
  assert(muse_receive_append(&r, 2, 0, 3, 0, borrowed, 2) == 0);
  borrowed[0] = 'X';
  assert(r.payload[0] == 'a');
  assert(muse_receive_append(&r, 2, 0, 3, 2, "c", 1) == 0);
  assert(muse_receive_append(&r, 9, 1, 1, 0, "p", 1) == 0);
  assert(muse_receive_append(&r, 0, 1, 2, 0, "de", 2) == 1);
  assert(r.size == 5 && !memcmp(r.payload, "abcde", 5));
  r.size = 0;
  assert(muse_receive_append(&r, 2, 1, 1, 0, "z", 1) == 1);
  r = (MuseReceive){0};
  assert(muse_receive_append(&r, 0, 1, 1, 0, "z", 1) == -1);
  assert(muse_receive_append(&r, 1, 1, 1, 0, "z", 1) == -1);
  r = (MuseReceive){0};
  assert(muse_receive_append(&r, 2, 1, 3, 0, "a", 1) == 0);
  assert(muse_receive_append(&r, 2, 1, 3, 2, "b", 1) == -1);
  r = (MuseReceive){0};
  assert(muse_receive_append(&r, 2, 1, MUSE_FRAME_MAX + 1, 0, NULL, MUSE_FRAME_MAX + 1) == -1);
  assert(muse_receive_append(&r, 2, 1, 0, 0, NULL, 0) == 1);
  static char full[65536];
  memset(full, 0x5a, sizeof(full));
  for (int total = 65534; total <= 65535; total++) {
    r = (MuseReceive){0};
    for (int offset = 0; offset < total;) {
      int count = total - offset > 4096 ? 4096 : total - offset;
      assert(muse_receive_append(&r, 2, 1, total, offset, full + offset, count) == (offset + count == total));
      offset += count;
    }
    assert(r.size == (size_t)total && !memcmp(r.payload, full, total));
  }
  r = (MuseReceive){0};
  assert(muse_receive_append(&r, 2, 1, 65536, 0, full, 4096) == -1);
  r = (MuseReceive){0};
  assert(muse_receive_append(&r, 2, 0, 32768, 0, full, 32768) == 0);
  assert(muse_receive_append(&r, 0, 1, 32767, 0, full, 32767) == 1);
  assert(r.size == 65535);
  r = (MuseReceive){0};
  assert(muse_receive_append(&r, 2, 0, 32768, 0, full, 32768) == 0);
  assert(muse_receive_append(&r, 0, 1, 32768, 0, full, 32768) == -1);
  puts("native receive tests passed");
}

