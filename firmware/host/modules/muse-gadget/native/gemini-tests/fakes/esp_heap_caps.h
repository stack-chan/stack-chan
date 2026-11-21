#pragma once
#include <stddef.h>
#define MALLOC_CAP_INTERNAL 1
#define MALLOC_CAP_SPIRAM 2
#define MALLOC_CAP_8BIT 4
void *heap_caps_malloc(size_t,unsigned);
void *heap_caps_calloc(size_t,size_t,unsigned);
void heap_caps_free(void *);
