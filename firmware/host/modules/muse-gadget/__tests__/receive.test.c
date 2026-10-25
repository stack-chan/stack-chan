#include "../native/receive.h"
#include "../native/lifetime.h"
#include <assert.h>
#include <stdio.h>
int main(void) {
  MuseLifetime life = {.references = 1};
  for (int i = 0; i < 4; i++) assert(muse_event_hold(&life));
  assert(!muse_event_hold(&life) && life.failed);
  assert(life.pending == 4 && life.references == 5);
  assert(muse_owner_close(&life));
  assert(!muse_owner_close(&life));
  assert(!muse_event_hold(&life));
  assert(!muse_event_release(&life)); /* owner joined task; queued events survive */
  for (int i = 0; i < 4; i++) {
    assert(!muse_event_begin(&life)); /* never call XS after close */
    assert(muse_event_release(&life) == (i == 3));
  }
  assert(life.pending == 0 && life.references == 0);
  MuseReceive r = {0};
  char borrowed[] = "abc";
  assert(muse_receive_append(&r, 2, 0, 3, 0, borrowed, 2) == 0);
  borrowed[0] = 'X';
  assert(r.payload[1] == 'a');
  assert(muse_receive_append(&r, 2, 0, 3, 2, "c", 1) == 0);
  assert(muse_receive_append(&r, 9, 1, 1, 0, "p", 1) == 0);
  assert(muse_receive_append(&r, 0, 1, 2, 0, "de", 2) == 1);
  assert(r.size == 5 && !memcmp(r.payload + 1, "abcde", 5));
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
  puts("native receive tests passed");
}
