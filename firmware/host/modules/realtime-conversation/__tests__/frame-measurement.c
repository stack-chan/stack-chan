// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
// Test-only link wrappers. Do not include or modify SDK implementations.
#include "piuMC.h"
#include "io-performance.h"
extern int __real_PocoDrawingEnd(Poco, PocoPixel *, int, PocoRenderedPixelsReceiver, void *);
extern PiuBoolean __real_PiuRegionEmpty(PiuRegion *);
static int drewPixels;
int __wrap_PocoDrawingEnd(Poco poco, PocoPixel *pixels, int length, PocoRenderedPixelsReceiver receiver, void *refcon) {
    int result = __real_PocoDrawingEnd(poco, pixels, length, receiver, refcon);
    if (!result) drewPixels = 1;
    return result;
}
PiuBoolean __wrap_PiuRegionEmpty(PiuRegion *region) {
    PiuBoolean result = __real_PiuRegionEmpty(region);
    if (drewPixels) { drewPixels = 0; stackchanFrameComplete(); }
    return result;
}
