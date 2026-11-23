#ifndef SANO_MODEL_FORMAT_H
#define SANO_MODEL_FORMAT_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define SANO_MODEL_BYTES 654032u
#define SANO_MODEL_HEADER_BYTES 64u
#define SANO_MODEL_OFFSET 4096u
#define SANO_MODEL_PARTITION_BYTES 0xB0000u
#define SANO_MODEL_PARTITION_ADDRESS 0xEF0000u
#define SANO_MODEL_PARTITION_LABEL "sanotts_model"
#define SANO_MODEL_SHA256 "a1eb6b0812e2ad2a228836088a3e34160cb66731492fb957a5891605db2fa1b6"
static const uint8_t sano_model_digest[32] = {
    0xa1,0xeb,0x6b,0x08,0x12,0xe2,0xad,0x2a,0x22,0x88,0x36,0x08,0x8a,0x3e,0x34,0x16,
    0x0c,0xb6,0x67,0x31,0x49,0x2f,0xb9,0x57,0xa5,0x89,0x16,0x05,0xdb,0x2f,0xa1,0xb6
};
static inline uint32_t sano_model_u32(const uint8_t *p) {
    return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

static inline int sano_model_header_check(const uint8_t *header) {
    return !memcmp(header, "SANOMDL1", 8) && sano_model_u32(header + 8) == 1 &&
        sano_model_u32(header + 12) == SANO_MODEL_HEADER_BYTES &&
        sano_model_u32(header + 16) == SANO_MODEL_OFFSET && sano_model_u32(header + 20) == SANO_MODEL_BYTES &&
        !memcmp(header + 24, sano_model_digest, sizeof(sano_model_digest)) && !memcmp(header + 56, "COMMIT01", 8);
}
#endif
