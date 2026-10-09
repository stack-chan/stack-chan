// SPDX-License-Identifier: Apache-2.0
#ifndef STACKCHAN_AVDS_RENDER_H
#define STACKCHAN_AVDS_RENDER_H
#include "avds-engine.h"
enum { AVDS_OUTLINES = 32, AVDS_GROUPS = 16 };
typedef struct { int32_t x, y, w, h; } AvdsRect;
typedef struct { AvdsRect clip, bounds; uint16_t command; } AvdsPrimitive;
typedef struct { AvdsPrimitive primitives[AVDS_OUTLINES]; uint16_t count; } AvdsRenderFrame;
// All rectangles are half-open, absolute canvas pixels. Empty is canonical.
AvdsError avds_render_prepare(const int32_t commands[][AVDS_STRIDE], unsigned count,
 int32_t width, int32_t height, AvdsRenderFrame *frame);
AvdsRect avds_render_damage(const int32_t oldCommands[][AVDS_STRIDE], const AvdsRenderFrame *oldFrame,
 const int32_t newCommands[][AVDS_STRIDE], const AvdsRenderFrame *newFrame);
#endif
