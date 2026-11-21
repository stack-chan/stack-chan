#pragma once
#include <stddef.h>
#include <string.h>

static int muse_chat_route_valid(int stream, int route) {
  if (route < 0 || route > 3) return 0;
  if (route == 0) return stream == 1;
  return stream >= (route == 2 ? 3 : 5) && (stream & 1);
}

static int muse_tts_path(char *out, size_t capacity, const char *id, int legacy) {
  static const char hex[] = "0123456789ABCDEF";
  const char *prefix = legacy ? "/voice/tts-stream?message_id=" : "/api/voice/tts-stream?message_id=";
  if (!out || !id || (legacy != 0 && legacy != 1)) return -1;
  size_t length = strlen(id), used = strlen(prefix);
  if (!length || length > 128 || capacity <= used) return -1;
  memcpy(out, prefix, used);
  for (size_t index = 0; index < length; index++) {
    unsigned char c = (unsigned char)id[index];
    if (c < 0x21 || c > 0x7e) return -1;
    int safe = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
      (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
    if (capacity - used <= (size_t)(safe ? 1 : 3)) return -1;
    if (safe) out[used++] = (char)c;
    else { out[used++] = '%'; out[used++] = hex[c >> 4]; out[used++] = hex[c & 15]; }
  }
  out[used] = 0;
  return 0;
}
