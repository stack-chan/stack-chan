#pragma once
#include <stddef.h>
#include <stdint.h>
// Deliberately distinct bits; the fixture rejects missing 8BIT or mixed pools.
#define MALLOC_CAP_8BIT 4
#define MALLOC_CAP_SPIRAM 1024
#define MALLOC_CAP_INTERNAL 2048
typedef struct multi_heap_info_t {
  size_t total_free_bytes, total_allocated_bytes, largest_free_block, minimum_free_bytes;
} multi_heap_info_t;
void heap_caps_get_info(multi_heap_info_t *info, uint32_t caps);
size_t heap_caps_get_total_size(uint32_t caps);
