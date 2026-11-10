// SPDX-FileCopyrightText: 2017-2026 Moddable Tech, Inc.
// SPDX-License-Identifier: LGPL-3.0-or-later
// Includes the Poco RGB565 outline compositing algorithm; see NOTICE.md.
#include "avds-engine.h"
#include "avds-render.h"
#include "avds-outline.h"
#include <stdint.h>
#include <string.h>
#include <freetype/config/public-macros.h>
#include "ftgrays.h"

enum { WEB_BYTES=70000, WEB_PIXELS=262144 };
static uint8_t bytes[WEB_BYTES], rgba[WEB_PIXELS*4];
static uint16_t pixels[WEB_PIXELS];
static float context[AVDS_CONTEXT];
static AvdsVM vm;
static AvdsRenderFrame frame;
static int32_t plan[AVDS_OUTLINES][9];
static uint32_t width,height;
typedef struct { uint16_t color; } SpanState;
// SDK Poco's RGB565LE opaque-outline compositing, including its 5-bit AA
// coverage rounding. Unsigned arithmetic makes the packed channel wrap defined.
static void spans(int y,int count,const FT_Span *span,void *user) {
 SpanState *state=user;
 uint32_t src32=(state->color|((uint32_t)state->color<<16))&0x07E0F81F;
 for (int i=0;i<count;i++,span++) {
  uint16_t *p=pixels+(uint32_t)y*width+span->x;
  for (unsigned j=0;j<span->len;j++,p++) {
   if (span->coverage==255) { *p=state->color; continue; }
   uint32_t dst=(*p|((uint32_t)*p<<16))&0x07E0F81F;
   dst=(span->coverage>>3)*(src32-dst)+(dst<<5)-dst;
   dst+=0x02008010; dst+=(dst>>5)&0x07E0F81F;
   dst=(dst>>5)&0x07E0F81F; dst|=dst>>16; *p=(uint16_t)dst;
  }
 }
}
void *web_bytes(void) { return bytes; }
void *web_context(void) { return context; }
void *web_commands(void) { return vm.commands; }
void *web_plan(void) { return plan; }
void *web_pixels(void) { return rgba; }
unsigned web_count(void) { return vm.count; }
unsigned web_primitives(void) { return frame.count; }
unsigned web_steps(void) { return vm.steps; }
const char *web_error(unsigned error) { return avds_error_string((AvdsError)error); }
unsigned web_run(unsigned size,unsigned budget,unsigned draws) {
 vm.count=0; frame.count=0;
 if (size>WEB_BYTES) return AVDS_FILE;
 if (budget<1 || budget>50000 || draws<1 || draws>AVDS_COMMANDS) return AVDS_CONTEXT_ERROR;
 if (!isfinite(context[0]) || !isfinite(context[1]) ||
     context[0]<1 || context[1]<1 || context[0]>1024 || context[1]>1024 ||
     context[0]!=floorf(context[0]) || context[1]!=floorf(context[1]) ||
     context[0]*context[1]>WEB_PIXELS) return AVDS_CONTEXT_ERROR;
 width=(uint32_t)context[0]; height=(uint32_t)context[1];
 AvdsError error; AvdsProgram *program=avds_program_create(bytes,size,&error);
 if (!program) return error;
 error=avds_run(&vm,program,context,budget,(uint16_t)draws);
 avds_program_delete(program);
 if (error) return error;
 error=avds_render_prepare(vm.commands,vm.count,width,height,&frame);
 if (error) return error;
 for (unsigned i=0;i<width*height;i++) pixels[i]=(uint16_t)context[11];
 FT_Raster raster; if (ft_grays_raster.raster_new(NULL,&raster)) return AVDS_MEMORY;
 for (unsigned i=0;i<frame.count;i++) {
  AvdsPrimitive *primitive=frame.primitives+i;
  const int32_t *c=vm.commands[primitive->command];
  int32_t *entry=plan[i]; entry[0]=primitive->command;
  memcpy(entry+1,&primitive->clip,sizeof(AvdsRect));
  memcpy(entry+5,&primitive->bounds,sizeof(AvdsRect));
  if (!primitive->bounds.w || !primitive->bounds.h) continue;
  int32_t coordinates[26]; uint8_t tags[13]; FT_Vector points[13];
  unsigned n=avds_outline_points(c,coordinates,tags);
  for (unsigned j=0;j<n;j++) points[j]=(FT_Vector){coordinates[j*2],coordinates[j*2+1]};
  unsigned short contour=(unsigned short)(n-1);
  FT_Outline outline={1,(short)n,points,tags,&contour,0};
  SpanState state={(uint16_t)c[7]}; FT_Raster_Params params={0};
  params.source=&outline; params.flags=FT_RASTER_FLAG_AA|FT_RASTER_FLAG_DIRECT|FT_RASTER_FLAG_CLIP;
  params.gray_spans=spans; params.user=&state;
  params.clip_box=(FT_BBox){primitive->bounds.x,primitive->bounds.y,
    primitive->bounds.x+primitive->bounds.w,primitive->bounds.y+primitive->bounds.h};
  // Match the native fixture's 16-row Poco raster bands. Bounding each call
  // also limits FreeType scan conversion scratch work for hostile outlines.
  for (unsigned band=0;band<height;band+=16) {
   int32_t top=primitive->bounds.y>(int32_t)band?primitive->bounds.y:(int32_t)band;
   int32_t bottom=primitive->bounds.y+primitive->bounds.h;
   if (bottom>(int32_t)band+16) bottom=(int32_t)band+16;
   if (bottom<=top) continue;
   params.clip_box.yMin=top; params.clip_box.yMax=bottom;
   if (ft_grays_raster.raster_render(raster,&params)) {
    ft_grays_raster.raster_done(raster); return AVDS_MEMORY;
   }
  }
 }
 ft_grays_raster.raster_done(raster);
 for (unsigned i=0;i<width*height;i++) {
  uint16_t p=pixels[i]; unsigned r=p>>11,g=(p>>5)&63,b=p&31;
  rgba[i*4]=(r<<3)|(r>>2); rgba[i*4+1]=(g<<2)|(g>>4);
  rgba[i*4+2]=(b<<3)|(b>>2); rgba[i*4+3]=255;
 }
 return 0;
}
