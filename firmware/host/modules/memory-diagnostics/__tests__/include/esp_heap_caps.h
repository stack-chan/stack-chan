#include <stdint.h>
#include <stddef.h>
#define MALLOC_CAP_INTERNAL 1
#define MALLOC_CAP_SPIRAM 2
#define MALLOC_CAP_8BIT 4
typedef struct {
	size_t total_free_bytes, total_allocated_bytes, largest_free_block, minimum_free_bytes;
} multi_heap_info_t;
void heap_caps_get_info(multi_heap_info_t *info, uint32_t caps);
