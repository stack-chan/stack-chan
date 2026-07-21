#include <stdint.h>

void twoHex(uint8_t value, char* out) {
  static const char hex[] = "0123456789ABCDEF";
  out[0] = hex[(value >> 4) & 0x0F];
  out[1] = hex[value & 0x0F];
}
