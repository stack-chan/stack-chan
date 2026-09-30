#ifndef STACKCHAN_HTTP_REUSE_H
#define STACKCHAN_HTTP_REUSE_H
#include <stdbool.h>
#include <string.h>

// Inputs have already passed the HTTPS URL validator. Compare the complete
// authority, including an explicit port. Conservative differences reconnect.
static inline bool liveHttpSameOrigin(const char *left, const char *right)
{
  const char *prefix = "https://";
  if (strncmp(left, prefix, 8) || strncmp(right, prefix, 8)) return false;
  const char *a = strchr(left + 8, '/'), *b = strchr(right + 8, '/');
  if (!a || !b || a == left + 8 || b == right + 8) return false;
  size_t length = (size_t)(a - left);
  return length == (size_t)(b - right) && !strncmp(left, right, length);
}
#endif
