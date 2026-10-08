// SPDX-License-Identifier: Apache-2.0
// Paired, no-pixel Poco commands measure only raster work between markers.
// Panel transfer occurs outside each pair. This module is diagnostic-only.
#include "piuMC.h"
#include "xsmc.h"
#include "commodettoPocoBlit.h"
#include <string.h>

typedef struct ProbeStruct ProbeRecord, *Probe;
typedef Probe PiuProbe;
struct ProbeStruct {
 PiuHandlePart;
 PiuIdlePart;
 PiuBehaviorPart;
 PiuContentPart;
 PiuContainerPart;
 uint64_t rasterUs, submitUs;
 uint32_t startUs, passes, pairs, unmatched;
 uint8_t started;
};
typedef struct { Probe *self; uint8_t after; } Marker;
static uint32_t clockUs(void) { return (uint32_t)modMicroseconds(); }
static const xsHostHooks hooks;
static void raster(Poco poco, uint8_t *data, PocoPixel *dst, PocoDimension w, PocoDimension h, uint8_t phase) {
 Marker marker; memcpy(&marker,data,sizeof(marker));
 Probe self=*marker.self;
 (void)poco; (void)dst; (void)w; (void)h; (void)phase;
 if (!marker.after) {
  if (self->started) self->unmatched++;
  self->startUs=clockUs(); self->started=1;
 } else {
  if (self->started) { self->rasterUs+=(uint32_t)(clockUs()-self->startUs); self->pairs++; }
  else self->unmatched++;
  self->started=0;
 }
}
static void marker(Poco poco, Probe *self, uint8_t after, PocoCoordinate x, PocoCoordinate y, PocoDimension w, PocoDimension h) {
 rotateCoordinatesAndDimensions(poco->width,poco->height,x,y,w,h);
 PocoCoordinate right=x+w,bottom=y+h;
 if (x<poco->x) x=poco->x;
 if (y<poco->y) y=poco->y;
 if (right>poco->xMax) right=poco->xMax;
 if (bottom>poco->yMax) bottom=poco->yMax;
 if (right<=x || bottom<=y) return;
 Marker value={self,after};
 PocoDrawExternal(poco,raster,(uint8_t*)&value,sizeof(value),x,y,right-x,bottom-y);
}
static void before(void *it, PiuView *view, PiuCoordinate x, PiuCoordinate y, PiuDimension w, PiuDimension h) {
 marker((*view)->poco,it,0,x,y,w,h);
}
static void after(void *it, PiuView *view, PiuCoordinate x, PiuCoordinate y, PiuDimension w, PiuDimension h) {
 marker((*view)->poco,it,1,x,y,w,h);
}
static void update(void *it, PiuView *view, PiuRectangle area) {
 Probe *self=it; PiuRectangle bounds=&(*self)->bounds;
 if (!((*self)->flags & piuVisible) || !PiuRectangleIntersects(bounds,area)) return;
 uint32_t start=clockUs();
 PiuViewDrawContent(view,before,it,bounds->x,bounds->y,bounds->width,bounds->height);
 PiuContainerUpdate(it,view,area);
 PiuViewDrawContent(view,after,it,bounds->x,bounds->y,bounds->width,bounds->height);
 (*self)->submitUs+=(uint32_t)(clockUs()-start); (*self)->passes++;
}
static const PiuDispatchRecord dispatch={"AvatarComparisonProbe",PiuContainerBind,PiuContainerCascade,PiuContentDraw,
 PiuContainerFitHorizontally,PiuContainerFitVertically,PiuContainerHit,PiuContentIdle,PiuContainerInvalidate,
 PiuContainerMeasureHorizontally,PiuContainerMeasureVertically,PiuContainerPlace,
 PiuContainerPlaceContentHorizontally,PiuContainerPlaceContentVertically,
 PiuContainerReflow,PiuContainerShowing,PiuContainerShown,PiuContentSync,PiuContainerUnbind,update};
static const xsHostHooks hooks={PiuContentDelete,PiuContainerMark,NULL};
void xs_avds_probe_create(xsMachine *the) {
 xsmcVars(4); xsmcSetHostChunk(xsThis,NULL,sizeof(ProbeRecord));
 Probe *self=PIU(Probe,xsThis);
 (*self)->the=the; (*self)->reference=xsmcToReference(xsThis);
 xsSetHostHooks(xsThis,(xsHostHooks*)&hooks); (*self)->dispatch=(PiuDispatch)&dispatch;
 (*self)->recordSize=PiuRecordSize(sizeof(ProbeRecord)); (*self)->flags=piuVisible|piuContainer;
 PiuContentDictionary(the,self); PiuContainerDictionary(the,self); PiuBehaviorOnCreate(self);
}
void xs_avds_probe_stats(xsMachine *the) {
 xsmcGetHostChunkValidate(xsThis,(void*)&hooks);
 Probe self=*PIU(Probe,xsThis); xsmcVars(1); xsmcSetNewObject(xsResult);
#define STAT(name,value) xsmcSetNumber(xsVar(0),(double)(value)); xsmcSet(xsResult,xsID(name),xsVar(0))
 STAT("rasterUs",self->rasterUs); STAT("submitUs",self->submitUs);
 STAT("passes",self->passes); STAT("pairs",self->pairs); STAT("unmatched",self->unmatched);
#undef STAT
}
void xs_avds_probe_us(xsMachine *the) { xsmcSetNumber(xsResult,clockUs()); }
