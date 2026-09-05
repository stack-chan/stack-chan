#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>

void xs_stackchan_clock_ticks(xsMachine* the)
{
    xsmcSetNumber(xsResult, emscripten_get_now());
}
