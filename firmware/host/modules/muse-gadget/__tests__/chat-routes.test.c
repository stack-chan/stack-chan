#include "../native/chat-routes.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
  assert(muse_chat_route_valid(1, 0));
  assert(!muse_chat_route_valid(3, 0));
  assert(muse_chat_route_valid(5, 1));
  assert(muse_chat_route_valid(3, 2));
  assert(muse_chat_route_valid(7, 2));
  assert(muse_chat_route_valid(5, 3));
  assert(!muse_chat_route_valid(3, 3));
  assert(!muse_chat_route_valid(6, 3));
  assert(!muse_chat_route_valid(5, 4));
  char out[432];
  assert(!muse_tts_path(out, sizeof(out), "msg-01_~.", 0));
  assert(!strcmp(out, "/api/voice/tts-stream?message_id=msg-01_~."));
  assert(!muse_tts_path(out, sizeof(out), "x/y?z&k=1%", 1));
  assert(!strcmp(out, "/voice/tts-stream?message_id=x%2Fy%3Fz%26k%3D1%25"));
  assert(muse_tts_path(out, sizeof(out), "", 0));
  assert(muse_tts_path(out, sizeof(out), "x\ny", 0));
  assert(muse_tts_path(out, sizeof(out), "white space", 0));
  assert(muse_tts_path(out, sizeof(out), "valid", 2));
  assert(muse_tts_path(out, 8, "valid", 0));
  char max[129]; memset(max, '/', 128); max[128] = 0;
  assert(!muse_tts_path(out, sizeof(out), max, 0));
  assert(strlen(out) == strlen("/api/voice/tts-stream?message_id=") + 384);
  char too_long[130]; memset(too_long, 'a', 129); too_long[129] = 0;
  assert(muse_tts_path(out, sizeof(out), too_long, 0));
  puts("chat route and TTS path tests passed");
  return 0;
}
