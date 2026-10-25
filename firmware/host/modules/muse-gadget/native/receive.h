#pragma once
#include "noise_api.h"
#include <string.h>
typedef struct {
  uint8_t payload[MUSE_FRAME_MAX + 1]; /* byte zero is the XS event type */
  size_t size, offset;
  uint8_t fragmented;
} MuseReceive;
/* Called only by the socket task. Copies borrowed SDK bytes before returning.
 * 1=complete message (caller consumes and resets size), 0=partial, -1=invalid.
 */
static inline int muse_receive_append(MuseReceive *r, int opcode, int fin,
    int total, int offset, const void *data, int size) {
  if (opcode >= 8) return 0;
  if (total < 0 || offset < 0 || offset > total || size < 0 || size > total - offset ||
      (size && !data) || (size_t)size > MUSE_FRAME_MAX - r->size) return -1;
  if (!offset) {
    r->offset = 0;
    if (opcode == 2 && !r->fragmented) r->fragmented = 1;
    else if (opcode != 0 || !r->fragmented) return -1;
  }
  if ((size_t)offset != r->offset) return -1;
  if (size) memcpy(r->payload + 1 + r->size, data, size);
  r->size += size;
  r->offset += size;
  if (r->offset == (size_t)total && fin) { r->fragmented = 0; return 1; }
  return 0;
}
