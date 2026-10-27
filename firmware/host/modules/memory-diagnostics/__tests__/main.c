// Execute the real XS binding with host stubs. These are API contracts, not
// substitutes for device heap values or an ESP-IDF target build.
#include <assert.h>
#include <string.h>
#include "xsmc.h"
#include "esp_heap_caps.h"

Slot result, variables[2];
static Slot objects[3];
static int reads, allocations, external;

int64_t esp_timer_get_time(void) { return 123456789; }
void heap_caps_get_info(multi_heap_info_t *info, uint32_t caps)
{
	const uint32_t expected[] = {MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT,
		MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT, MALLOC_CAP_8BIT};
	assert(allocations == 0);
	assert(caps == expected[reads]);
	size_t scale = (reads == 1 && !external) ? 0 : (size_t)(reads + 1);
	*info = (multi_heap_info_t){1000 * scale, 2000 * scale, 600 * scale, 400 * scale};
	reads++;
}
void new_object(Slot *slot)
{
	assert(reads == 3); // No result-object allocation perturbs any capture.
	memset(slot, 0, sizeof(*slot));
	allocations++;
}
void set_property(Slot *object, const char *name, Slot *value)
{
	assert(object->count < 8);
	Property *p = &object->properties[object->count++];
	p->name = name;
	p->number = value->number;
	p->slot = NULL;
	if (value == &variables[1]) {
		int index = allocations - 2;
		assert(index >= 0 && index < 3);
		objects[index] = *value;
		p->slot = &objects[index];
	}
}
static Property *get(Slot *object, const char *name)
{
	for (int i = 0; i < object->count; i++)
		if (!strcmp(object->properties[i].name, name)) return &object->properties[i];
	assert(0);
	return NULL;
}
void xs_stackchan_heap_snapshot(xsMachine *the);
int main(void)
{
	const char *names[] = {"internal", "psram", "all8bit"};
	for (external = 0; external <= 1; external++) {
		reads = allocations = 0;
		xs_stackchan_heap_snapshot(NULL);
		assert(reads == 3 && allocations == 4);
		assert(get(&result, "uptimeMs")->number == 123456.789);
		assert(get(&result, "internalReserveBytes")->number == 98304);
		assert(get(&result, "alwaysInternalBytes")->number == 1024);
		for (int i = 0; i < 3; i++) {
			Slot *region = get(&result, names[i])->slot;
			double scale = (i == 1 && !external) ? 0 : i + 1;
			assert(get(region, "freeBytes")->number == 1000 * scale);
			assert(get(region, "allocatedBytes")->number == 2000 * scale);
			assert(get(region, "minFreeBytes")->number == 400 * scale);
			assert(get(region, "largestFreeBytes")->number == 600 * scale);
		}
	}
	return 0;
}
