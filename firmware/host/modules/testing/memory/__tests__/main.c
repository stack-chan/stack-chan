#include "xsHost.h"
#include "xsmc.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include <assert.h>
#include <string.h>

struct TestObject {
  const char *keys[8];
  TestValue values[8];
  unsigned count;
};
static TestObject objects[3];
static unsigned objectCount, reads, timeReads;
static int absentPsram;
static multi_heap_info_t heaps[2];
static const size_t totals[] = {300000, 8000000};
TestValue result, variables[2];
void xs_memory_diagnostics_snapshot(xsMachine *the);

static unsigned pool(uint32_t caps) {
  if (caps == (MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)) return 0;
  assert(caps == (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  return 1;
}
void heap_caps_get_info(multi_heap_info_t *info, uint32_t caps) {
  assert(!objectCount);
  unsigned i = pool(caps);
  *info = (i && absentPsram) ? (multi_heap_info_t){0} : heaps[i];
  reads++;
}
size_t heap_caps_get_total_size(uint32_t caps) {
  assert(!objectCount);
  unsigned i = pool(caps);
  reads++;
  return (i && absentPsram) ? 0 : totals[i];
}
int64_t esp_timer_get_time(void) {
  assert(!objectCount);
  return INT64_C(5000000000) + 10 * timeReads++;
}
TestValue testNewObject(void) {
  assert(reads == 4 && timeReads == 2);
  assert(objectCount < 3);
  // Model result allocation changing the live heaps after acquisition.
  heaps[0].total_free_bytes--;
  heaps[1].total_free_bytes--;
  return (TestValue){.object = &objects[objectCount++]};
}
void testSet(TestValue object, const char *key, TestValue value) {
  TestObject *o = object.object;
  assert(o && o->count < 8);
  o->keys[o->count] = key;
  o->values[o->count++] = value;
}
static TestValue get(TestValue object, const char *key) {
  TestObject *o = object.object;
  for (unsigned i = 0; i < o->count; i++)
    if (!strcmp(key, o->keys[i])) return o->values[i];
  assert(0);
  return (TestValue){0};
}
int main(void) {
  for (unsigned run = 0; run < 3; run++) {
    memset(objects, 0, sizeof(objects));
    objectCount = reads = timeReads = 0;
    absentPsram = run == 2;
    heaps[0] = (multi_heap_info_t){100000 - run * 1000, 150000 + run * 1000, 40000, 80000};
    heaps[1] = (multi_heap_info_t){7000000, 900000, 6000000, 6500000};
    multi_heap_info_t expected[2] = {heaps[0], absentPsram ? (multi_heap_info_t){0} : heaps[1]};
    xsMachine machine = {0};
    xs_memory_diagnostics_snapshot(&machine);
    assert(objectCount == 3);
    assert(get(result, "atUs").number == 5000000000.0);
    assert(get(result, "durationUs").number == 10);
    for (unsigned i = 0; i < 2; i++) {
      TestValue value = get(result, i ? "psram" : "internal");
      assert(get(value, "totalBytes").number == ((i && absentPsram) ? 0 : totals[i]));
      assert(get(value, "freeBytes").number == expected[i].total_free_bytes);
      assert(get(value, "allocatedBytes").number == expected[i].total_allocated_bytes);
      assert(get(value, "minimumFreeBytes").number == expected[i].minimum_free_bytes);
      assert(get(value, "largestFreeBlockBytes").number == expected[i].largest_free_block);
    }
  }
  return 0;
}
