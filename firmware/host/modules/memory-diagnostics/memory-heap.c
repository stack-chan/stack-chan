#include "xsmc.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "sdkconfig.h"

void xs_stackchan_heap_snapshot(xsMachine *the)
{
	multi_heap_info_t info[3];
	const uint32_t caps[] = {
		MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT,
		MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT,
		MALLOC_CAP_8BIT
	};
	const char *names[] = {"internal", "psram", "all8bit"};
	int64_t uptime = esp_timer_get_time();
	/* Capture ALL regions before creating XS objects/strings. These sequential
	 * IDF reads are not atomic across concurrently allocating native tasks. */
	for (int i = 0; i < 3; i++)
		heap_caps_get_info(&info[i], caps[i]);

	xsmcVars(2);
	xsmcSetNewObject(xsResult);
	xsmcSetNumber(xsVar(0), uptime / 1000.0);
	xsmcSet(xsResult, xsID("uptimeMs"), xsVar(0));
#define NUMBER(object, key, value) \
	xsmcSetNumber(xsVar(0), value); xsmcSet(object, xsID(key), xsVar(0))
#ifdef CONFIG_SPIRAM_MALLOC_RESERVE_INTERNAL
	NUMBER(xsResult, "internalReserveBytes", CONFIG_SPIRAM_MALLOC_RESERVE_INTERNAL);
#endif
#ifdef CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL
	NUMBER(xsResult, "alwaysInternalBytes", CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL);
#endif
	for (int i = 0; i < 3; i++) {
		xsmcSetNewObject(xsVar(1));
		NUMBER(xsVar(1), "freeBytes", info[i].total_free_bytes);
		NUMBER(xsVar(1), "allocatedBytes", info[i].total_allocated_bytes);
		NUMBER(xsVar(1), "minFreeBytes", info[i].minimum_free_bytes);
		NUMBER(xsVar(1), "largestFreeBytes", info[i].largest_free_block);
		xsmcSet(xsResult, xsID(names[i]), xsVar(1));
	}
#undef NUMBER
}
