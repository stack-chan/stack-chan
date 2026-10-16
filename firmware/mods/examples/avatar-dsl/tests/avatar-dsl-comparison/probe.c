// SPDX-License-Identifier: Apache-2.0
// Paired, no-pixel Poco commands measure only raster work between markers.
// Panel transfer occurs outside each pair. This module is diagnostic-only.
#include "piuMC.h"
#include "xsmc.h"
#include "commodettoPocoBlit.h"
#include <string.h>
#include <stdlib.h>

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

// Preserve driver buffers, lengths, async flags, queue sizes and wait behavior.
// sendUs includes copy/queue and SPI completion waits, not just wire time.
typedef struct {
 PixelsOutDispatch dispatch, original;
 PixelsOutDispatchRecord record;
 void *refcon;
 xsSlot screen;
 uint64_t beginUs, sendUs, endUs, displayUs, cycleUs, bytes;
 uint32_t begins, sends, ends, syncSends, asyncSends, cycleCount;
 uint32_t beginAt, lastEnd, cycleMin, cycleMax;
} DisplayProbe;
static DisplayProbe *display;
static void displayBegin(void *it, CommodettoCoordinate x, CommodettoCoordinate y, CommodettoDimension w, CommodettoDimension h) {
 DisplayProbe *p=it; uint32_t start=clockUs(); p->beginAt=start;
 p->original->doBegin(p->refcon,x,y,w,h);
 p->beginUs+=(uint32_t)(clockUs()-start); p->begins++;
}
static void displaySend(PocoPixel *pixels, int length, void *it) {
 DisplayProbe *p=it; uint32_t start=clockUs();
 p->original->doSend(pixels,length,p->refcon);
 p->sendUs+=(uint32_t)(clockUs()-start); p->sends++;
 p->bytes+=length<0?-length:length;
 if (length<0) p->asyncSends++; else p->syncSends++;
}
static void displayContinue(void *it) {
 DisplayProbe *p=it; uint32_t start=clockUs();
 p->original->doContinue(p->refcon);
 p->endUs+=(uint32_t)(clockUs()-start);
 p->displayUs+=(uint32_t)(clockUs()-p->beginAt);
}
static void displayEnd(void *it) {
 DisplayProbe *p=it; uint32_t start=clockUs();
 p->original->doEnd(p->refcon);
 p->endUs+=(uint32_t)(clockUs()-start);
 uint32_t end=clockUs(); p->displayUs+=(uint32_t)(end-p->beginAt); p->ends++;
 if (p->lastEnd) {
  uint32_t cycle=end-p->lastEnd; p->cycleUs+=cycle; p->cycleCount++;
  if (cycle<p->cycleMin) p->cycleMin=cycle;
  if (cycle>p->cycleMax) p->cycleMax=cycle;
 }
 p->lastEnd=end;
}
static void displayAdapt(void *it, CommodettoRectangle r) {
 DisplayProbe *p=it; if (p->original->doAdaptInvalid) p->original->doAdaptInvalid(p->refcon,r);
}
static void displayDelete(void *it) { if (display==it) display=NULL; free(it); }
static void displayMark(xsMachine *the, void *it, xsMarkRoot markRoot) { DisplayProbe *p=it; if (p) (*markRoot)(the,&p->screen); }
static const xsHostHooks displayHooks={displayDelete,displayMark,NULL};
void xs_avds_probe_display(xsMachine *the) {
 if (display) xsUnknownError("AVDS: display probe already installed");
 void *refcon=xsmcGetHostData(xsArg(0));
 PixelsOutDispatch original=refcon?*(PixelsOutDispatch*)refcon:NULL;
 if (!original || !original->doBegin || !original->doSend || !original->doEnd || !original->doContinue)
  xsUnknownError("AVDS: unsupported display dispatch");
 DisplayProbe *p=calloc(1,sizeof(*p)); if (!p) xsUnknownError("AVDS: display probe allocation");
 xsResult=xsNewHostObject(displayDelete); xsmcSetHostData(xsResult,p); xsSetHostHooks(xsResult,(xsHostHooks*)&displayHooks);
 p->record=*original; p->record.doBegin=displayBegin; p->record.doContinue=displayContinue;
 p->record.doEnd=displayEnd; p->record.doSend=displaySend;
 p->record.doAdaptInvalid=original->doAdaptInvalid?displayAdapt:NULL;
 p->dispatch=&p->record; p->original=original; p->refcon=refcon;
 p->screen=xsArg(0); p->cycleMin=UINT32_MAX; display=p;
}
void xs_avds_probe_display_stats(xsMachine *the) {
 DisplayProbe *p=display; if (!p) xsUnknownError("AVDS: display probe not installed");
 xsmcVars(1); xsmcSetNewObject(xsResult);
#define STAT(name,value) xsmcSetNumber(xsVar(0),(double)(value)); xsmcSet(xsResult,xsID(name),xsVar(0))
 STAT("beginUs",p->beginUs); STAT("sendUs",p->sendUs); STAT("endUs",p->endUs); STAT("displayUs",p->displayUs);
 STAT("cycleUs",p->cycleUs); STAT("cycleCount",p->cycleCount); STAT("cycleMin",p->cycleMin); STAT("cycleMax",p->cycleMax);
 STAT("begins",p->begins); STAT("sends",p->sends); STAT("ends",p->ends); STAT("bytes",p->bytes);
 STAT("syncSends",p->syncSends); STAT("asyncSends",p->asyncSends);
#undef STAT
}
