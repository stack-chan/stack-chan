// SPDX-License-Identifier: Apache-2.0
// Uses Moddable SDK 9.5 Piu/Poco APIs. Engine license is BSL-1.0.
#include "piuMC.h"
#include "xsmc.h"
#include <ft2build.h>
#include <freetype/freetype.h>
#include "commodettoPocoOutline.h"
#include "commodettoPocoBlit.h"
#include "avds-engine.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#if ESP32
#include "esp_heap_caps.h"
#endif
#if !defined(modMicroseconds)
#include <time.h>
#endif

// Fixed storage uses FT_Pos's actual ABI size (32-bit MCU / 64-bit Linux).
typedef union { double alignment; uint8_t bytes[PocoOutlineByteLength(13,1)]; } AvdsOutline;
typedef struct {
 AvdsProgram *program, *safe;
 AvdsVM vm;
 float state[AVDS_CONTEXT], context[AVDS_CONTEXT], safeContext[AVDS_CONTEXT], lastContext[AVDS_CONTEXT];
 int32_t commands[AVDS_COMMANDS][AVDS_STRIDE];
 AvdsOutline outlines[32];
 uint16_t count, outlineCount, draws;
 uint32_t instructions, elapsed, evaluations, updates, ticks, preparations, rasterPasses, failures, geometryChanges;
 uint64_t vmUs, geometryUs, rasterSubmitUs, rasterUs, rasterStartUs;
 AvdsError error;
 uint8_t enabled, paused, disposed, stateBreath, hasFrame;
} AvdsFaceState;
typedef struct AvdsFaceStruct AvdsFaceRecord, *AvdsFace;
typedef AvdsFace PiuAvdsFace;
struct AvdsFaceStruct {
 PiuHandlePart;
 PiuIdlePart;
 PiuBehaviorPart;
 PiuContentPart;
 AvdsFaceState *engine;
};
static const xsHostHooks hooks;
static uint32_t faceAllocations, vmAllocations;
static void *faceStorage(void) {
#if ESP32 && CONFIG_SPIRAM
 void *p=heap_caps_calloc(1,sizeof(AvdsFaceState),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
 if (p) return p;
#endif
 return calloc(1,sizeof(AvdsFaceState));
}
static AvdsFace *checkedFace(xsMachine *the) {
 xsmcGetHostChunkValidate(xsThis,(void*)&hooks);
 return PIU(AvdsFace,xsThis);
}
static uint64_t nowUs(void) {
#if defined(modMicroseconds)
 return modMicroseconds();
#else
 return (uint64_t)((double)clock()*1000000/CLOCKS_PER_SEC);
#endif
}
static uint64_t durationUs(uint64_t start) {
#if defined(modMicroseconds)
 return (uint32_t)((uint32_t)nowUs()-(uint32_t)start);
#else
 return nowUs()-start;
#endif
}
static void readContext(xsMachine *the, xsSlot slot, float *copy) {
 void *input; xsUnsignedValue size;
 xsmcGetBufferReadable(slot,&input,&size);
 if (size!=AVDS_CONTEXT*sizeof(float)) xsRangeError("AVDS: context size");
 memcpy(copy,input,size);
 for (unsigned i=0;i<AVDS_CONTEXT;i++) if (!isfinite(copy[i])) xsRangeError("AVDS: non-finite context");
 if (copy[0]<1 || copy[0]>1024 || copy[1]<1 || copy[1]>1024 || copy[2]<=0) xsRangeError("AVDS: canvas range");
 if (copy[11]<0 || copy[11]>65535) xsRangeError("AVDS: background color range");
}
static void budgets(xsMachine *the, xsSlot a, xsSlot b, uint32_t *instructions, uint16_t *draws) {
 double i=xsmcToNumber(a), d=xsmcToNumber(b);
 if (!isfinite(i) || i<1 || i>50000 || i!=floor(i) || !isfinite(d) || d<1 || d>AVDS_COMMANDS || d!=floor(d))
  xsRangeError("AVDS: budget");
 *instructions=(uint32_t)i; *draws=(uint16_t)d;
}
static AvdsProgram *readProgram(xsMachine *the, xsSlot slot, AvdsError *error) {
 void *bytes; xsUnsignedValue size;
 xsmcGetBufferReadable(slot,&bytes,&size);
 return avds_program_create(bytes,size,error);
}
static void avatarStop(AvdsFace *self) {
 if ((*self)->flags & piuIdling) {
  (*self)->flags &= ~piuIdling;
  if ((*self)->application) PiuApplicationStopContent((*self)->application,(PiuContent*)self);
 }
}
static void avatarSync(AvdsFace *self) {
 AvdsFaceState *s=(*self)->engine;
 if (s && s->enabled && !s->paused && !s->disposed && (*self)->application && PiuContentIsShown(self)) {
  if (!((*self)->flags & piuIdling)) {
   (*self)->flags |= piuIdling;
   PiuApplicationStartContent((*self)->application,(PiuContent*)self);
  }
 } else avatarStop(self);
}
// Outline geometry is built directly in bounded storage, using the same 26.6
// four-cubic circle as CanvasPath.arc(0, 2*pi). No JS paths, Shapes or Skins.
static void buildOutline(AvdsOutline *storage, const int32_t *c) {
 unsigned n=c[0]==AVDS_RECT?4:c[0]==AVDS_TRIANGLE?3:13;
 PocoOutline o=(PocoOutline)storage->bytes;
 memset(storage,0,sizeof(*storage)); o->n_points=n; o->n_contours=1;
 FT_Pos *p=(FT_Pos*)(storage->bytes+sizeof(PocoOutlineRecord));
 uint16_t *contour=(uint16_t*)(p+n*2);
 uint8_t *tags=(uint8_t*)(contour+1);
 *contour=(uint16_t)(n-1);
 if (c[0]==AVDS_RECT) {
  int32_t xy[8]={c[1],c[2],c[1]+c[3],c[2],c[1]+c[3],c[2]+c[4],c[1],c[2]+c[4]};
  for (unsigned i=0;i<8;i++) p[i]=(FT_Pos)xy[i]*64;
  memset(tags,1,n);
 } else if (c[0]==AVDS_TRIANGLE) {
  for (unsigned i=0;i<6;i++) p[i]=(FT_Pos)c[i+1]*64;
  memset(tags,1,n);
 } else {
  const double pi=3.14159265358979323846, delta=pi/2, ratio=(4*tan(delta/4))/3;
  double theta=0, x1=cos(theta), y1=sin(theta);
  p[0]=(FT_Pos)((c[3]*x1+c[1])*64); p[1]=(FT_Pos)((c[3]*y1+c[2])*64); tags[0]=1;
  for (unsigned i=0;i<4;i++) {
   theta+=delta; double x2=cos(theta), y2=sin(theta);
   unsigned j=2+i*6;
   p[j]=(FT_Pos)((c[3]*(x1-y1*ratio)+c[1])*64);
   p[j+1]=(FT_Pos)((c[3]*(y1+x1*ratio)+c[2])*64);
   p[j+2]=(FT_Pos)((c[3]*(x2+y2*ratio)+c[1])*64);
   p[j+3]=(FT_Pos)((c[3]*(y2-x2*ratio)+c[2])*64);
   p[j+4]=(FT_Pos)((c[3]*x2+c[1])*64); p[j+5]=(FT_Pos)((c[3]*y2+c[2])*64);
   tags[1+i*3]=tags[2+i*3]=2; tags[3+i*3]=1; x1=x2; y1=y2;
  }
 }
}
static int drawable(const int32_t *c) {
 return c[0]==AVDS_TRIANGLE || (c[0]==AVDS_CIRCLE && c[3]>0) || (c[0]==AVDS_RECT && c[3]>0 && c[4]>0);
}
static void evaluate(AvdsFace *self) {
 AvdsFaceState *s=(*self)->engine;
 if (!s || s->paused || s->disposed) return;
 memcpy(s->context,s->state,sizeof(s->context));
 s->context[3]=(float)s->elapsed;
 float breath=(float)sin((s->elapsed*2*3.14159265358979323846)/4000);
 if (!s->stateBreath || s->error) s->context[4]=breath;
 unsigned t=s->elapsed%4000;
 double blink=!s->enabled || t<2800?1:t<2890?1-(t-2800)/90.0:t<2935?0:t<3135?(t-2935)/200.0:1;
 s->context[5]=(float)(s->state[5]*blink);
 if (s->error) {
  memcpy(s->context+12,s->safeContext+12,(AVDS_CONTEXT-12)*sizeof(float));
  s->context[2]=s->safeContext[2]; s->context[31]=s->context[8];
 }
 if (s->hasFrame && !memcmp(s->context,s->lastContext,sizeof(s->context))) return;
 s->preparations++;
 uint64_t start=nowUs(); s->evaluations++;
 AvdsError e=avds_run(&s->vm,s->error?s->safe:s->program,s->context,s->error?12000:s->instructions,s->error?AVDS_COMMANDS:s->draws);
 unsigned primitives=0;
 if (!e) for (unsigned i=0;i<s->vm.count;i++) if (s->vm.commands[i][0]<AVDS_BEGIN) primitives++;
 if (!e && primitives>32) e=AVDS_PRIMITIVES;
 if (e && !s->error) {
  s->error=e; s->failures++;
  s->context[4]=breath;
  memcpy(s->context+12,s->safeContext+12,(AVDS_CONTEXT-12)*sizeof(float));
  s->context[2]=s->safeContext[2]; s->context[31]=s->context[8];
  s->evaluations++;
  e=avds_run(&s->vm,s->safe,s->context,12000,AVDS_COMMANDS);
  primitives=0;
  if (!e) for (unsigned i=0;i<s->vm.count;i++) if (s->vm.commands[i][0]<AVDS_BEGIN) primitives++;
  if (!e && primitives>32) e=AVDS_PRIMITIVES;
 }
 s->vmUs+=durationUs(start);
 if (e) return; // Last complete frame remains visible; no partial publication.
 start=nowUs();
 int geometryChanged=!s->hasFrame || s->count!=s->vm.count;
 int changed=geometryChanged || s->lastContext[11]!=s->context[11];
 for (unsigned i=0;i<s->vm.count;i++) {
  if (memcmp(s->vm.commands[i],s->commands[i],7*sizeof(int32_t))) geometryChanged=1;
  if (s->vm.commands[i][7]!=s->commands[i][7]) changed=1;
 }
 changed |= geometryChanged;
 unsigned outline=0;
 for (unsigned i=0;i<s->vm.count;i++) {
  const int32_t *c=s->vm.commands[i];
  if (drawable(c)) {
   // Rebuild when primitive indices changed, including preceding zero-size shapes.
   if (geometryChanged) { buildOutline(s->outlines+outline,c); s->geometryChanges++; }
   outline++;
  }
 }
 s->outlineCount=outline; s->count=s->vm.count;
 memcpy(s->commands,s->vm.commands,s->count*sizeof(s->commands[0]));
 memcpy(s->lastContext,s->context,sizeof(s->context)); s->hasFrame=1;
 s->geometryUs+=durationUs(start);
 if (changed) PiuContentInvalidate(self,NULL);
}
static PocoColor color(Poco poco, uint16_t c) {
 unsigned r=(c>>11)&31,g=(c>>5)&63,b=c&31;
 uint8_t red=(r<<3)|(r>>2), green=(g<<2)|(g>>4), blue=(b<<3)|(b>>2);
 return PocoMakeColor(poco,red,green,blue);
}
#if mxInstrument
typedef struct { AvdsFaceState *state; uint8_t after; } RasterMarker;
static void rasterMarker(Poco poco, uint8_t *data, PocoPixel *dst, PocoDimension w, PocoDimension h, uint8_t phase) {
 RasterMarker marker; memcpy(&marker,data,sizeof(marker));
 (void)poco; (void)dst; (void)w; (void)h; (void)phase;
 if (marker.after) marker.state->rasterUs+=durationUs(marker.state->rasterStartUs);
 else marker.state->rasterStartUs=nowUs();
}
static void submitMarker(Poco poco, AvdsFaceState *state, uint8_t after,
 PocoCoordinate x, PocoCoordinate y, PocoDimension w, PocoDimension h) {
 // External commands require caller-provided rotation and clipping, unlike fill.
 rotateCoordinatesAndDimensions(poco->width,poco->height,x,y,w,h);
 PocoCoordinate right=x+w,bottom=y+h;
 if (x<poco->x) x=poco->x;
 if (y<poco->y) y=poco->y;
 if (right>poco->xMax) right=poco->xMax;
 if (bottom>poco->yMax) bottom=poco->yMax;
 if (right<=x || bottom<=y) return;
 RasterMarker marker={state,after};
 PocoDrawExternal(poco,rasterMarker,(uint8_t*)&marker,sizeof(marker),x,y,right-x,bottom-y);
}
#endif
static void drawAux(void *it, PiuView *view, PiuCoordinate x, PiuCoordinate y, PiuDimension w, PiuDimension h) {
 AvdsFace *self=it; AvdsFaceState *s=(*self)->engine;
 if (!s || s->disposed || !s->hasFrame) return;
 uint64_t start=nowUs(); Poco poco=(*view)->poco;
#if mxInstrument
 submitMarker(poco,s,0,x,y,w,h);
#endif
 PocoRectangleFill(poco,color(poco,(uint16_t)s->lastContext[11]),255,x,y,w,h);
 unsigned outline=0;
 for (unsigned i=0;i<s->count;i++) if (drawable(s->commands[i]))
  PocoOutlineFill(poco,color(poco,(uint16_t)s->commands[i][7]),255,(PocoOutline)s->outlines[outline++].bytes,x,y);
#if mxInstrument
 submitMarker(poco,s,1,x,y,w,h);
#endif
 s->rasterPasses++; s->rasterSubmitUs+=durationUs(start);
}
static void avatarDraw(void *it, PiuView *view, PiuRectangle area) {
 AvdsFace *self=it;
 if (!(*self)->engine || (*self)->engine->disposed) return;
 PiuViewPushClip(view,0,0,(*self)->bounds.width,(*self)->bounds.height);
 PiuViewDrawContent(view,drawAux,it,0,0,(*self)->bounds.width,(*self)->bounds.height);
 PiuViewPopClip(view);
}
static void avatarIdle(void *it, PiuInterval interval) {
 AvdsFace *self=it; AvdsFaceState *s=(*self)->engine;
 if (!s || s->disposed || s->paused || !s->enabled || !PiuContentIsShown(self)) { avatarStop(self); return; }
 s->ticks++; s->elapsed+=(uint32_t)(interval<0?0:interval>100?100:interval);
 PiuContentUseIdle(self)->time+=interval;
 evaluate(self);
}
static void avatarBind(void *it, PiuApplication *app, PiuView *view) { PiuContentBind(it,app,view); avatarSync(it); }
static void avatarUnbind(void *it, PiuApplication *app, PiuView *view) { avatarStop(it); PiuContentUnbind(it,app,view); }
static void avatarShown(void *it, PiuBoolean show) { PiuContentShown(it,show); avatarSync(it); }
static void avatarDestroy(void *it) {
 AvdsFace s=it;
 if (s->engine) { avds_program_delete(s->engine->program); avds_program_delete(s->engine->safe); free(s->engine); faceAllocations--; }
}
static const PiuDispatchRecord dispatch={"AvatarNative",avatarBind,PiuContentCascade,avatarDraw,
 PiuContentFitHorizontally,PiuContentFitVertically,PiuContentHit,avatarIdle,PiuContentInvalidate,
 PiuContentMeasureHorizontally,PiuContentMeasureVertically,PiuContentPlace,NULL,NULL,
 PiuContentReflow,PiuContentShowing,avatarShown,PiuContentSync,avatarUnbind,PiuContentUpdate};
static const xsHostHooks hooks={avatarDestroy,PiuContentMark,NULL};
void xs_avds_face_create(xsMachine *the) {
 xsmcVars(4); xsmcSetHostChunk(xsThis,NULL,sizeof(AvdsFaceRecord));
 AvdsFace *self=PIU(AvdsFace,xsThis);
 (*self)->the=the; (*self)->reference=xsmcToReference(xsThis);
 xsSetHostHooks(xsThis,(xsHostHooks*)&hooks); (*self)->dispatch=(PiuDispatch)&dispatch;
 (*self)->recordSize=PiuRecordSize(sizeof(AvdsFaceRecord)); (*self)->flags=piuVisible;
 PiuContentDictionary(the,self);
 PiuContentUseIdle(self)->interval=33;
}
void xs_avds_face_initialize(xsMachine *the) {
 AvdsFace *self=checkedFace(the);
 if ((*self)->engine) xsUnknownError("AVDS: already initialized");
 // Attach before any throwing binding call so GC owns every acquired resource.
 AvdsFaceState *s=faceStorage(); if (!s) xsUnknownError("AVDS: allocation"); (*self)->engine=s; faceAllocations++;
 readContext(the,xsArg(2),s->state); readContext(the,xsArg(3),s->safeContext);
 if (memcmp(s->state,s->safeContext,3*sizeof(float))) xsRangeError("AVDS: fallback geometry");
 budgets(the,xsArg(4),xsArg(5),&s->instructions,&s->draws);
 AvdsError e; s->safe=readProgram(the,xsArg(1),&e); if (!s->safe) xsUnknownError("AVDS: invalid safe program");
 s->program=readProgram(the,xsArg(0),&s->error);
 if (s->error) s->failures++;
 s->enabled=1; s->stateBreath=xsmcToBoolean(xsArg(6)); evaluate(self); avatarSync(self);
}
static AvdsFaceState *state(xsMachine *the, AvdsFace *self) {
 AvdsFaceState *s=(*self)->engine; if (!s || s->disposed) xsUnknownError("AVDS: disposed"); return s;
}
void xs_avds_face_context(xsMachine *the) {
 AvdsFace *self=checkedFace(the); AvdsFaceState *s=state(the,self); float ctx[AVDS_CONTEXT];
 readContext(the,xsArg(0),ctx);
 if (memcmp(ctx,s->safeContext,3*sizeof(float))) xsRangeError("AVDS: immutable geometry");
 memcpy(s->state,ctx,sizeof(ctx)); s->updates++;
 // Visible animation has one native evaluation clock. Host state writes are
 // coalesced into its next tick; stopped/unbound faces prepare immediately.
 if (!s->enabled || !(*self)->application) evaluate(self);
}
void xs_avds_face_motions(xsMachine *the) { AvdsFace *self=checkedFace(the); state(the,self)->enabled=xsmcToBoolean(xsArg(0)); avatarSync(self); evaluate(self); }
void xs_avds_face_invalidate(xsMachine *the) {
 AvdsFace *self=checkedFace(the); PiuRectangleRecord area;
 PiuRectangleSet(&area,xsmcToInteger(xsArg(0)),xsmcToInteger(xsArg(1)),xsmcToInteger(xsArg(2)),xsmcToInteger(xsArg(3)));
 PiuContentInvalidate(self,&area);
}
void xs_avds_face_pause(xsMachine *the) { AvdsFace *self=checkedFace(the); state(the,self)->paused=xsmcToBoolean(xsArg(0)); avatarSync(self); evaluate(self); }
void xs_avds_face_close(xsMachine *the) {
 AvdsFace *self=checkedFace(the); avatarStop(self);
 if ((*self)->engine) (*self)->engine->disposed=1;
 PiuContentInvalidate(self,NULL); (*self)->flags&=~piuVisible;
 // Keep data alive until the Piu host object is collected. Pending avatarDraw lists
 // may still contain this content's handle; disposal never frees their pointers.
}
void xs_avds_face_snapshot(xsMachine *the) {
 AvdsFace *self=checkedFace(the); AvdsFaceState *s=state(the,self);
 void *ctx,*cmd; xsUnsignedValue a,b;
 xsmcGetBufferWritable(xsArg(0),&ctx,&a); xsmcGetBufferWritable(xsArg(1),&cmd,&b);
 if (a!=sizeof(s->context) || b<sizeof(s->commands)) xsRangeError("AVDS: snapshot size");
 memcpy(ctx,s->hasFrame?s->lastContext:s->context,a);
 memcpy(cmd,s->commands,sizeof(s->commands)); xsResult=xsInteger(s->count);
}
void xs_avds_face_failure(xsMachine *the) {
 AvdsFace *self=checkedFace(the); AvdsFaceState *s=(*self)->engine;
 if (s && s->error) xsResult=xsString(avds_error_string(s->error));
}
void xs_avds_face_stats(xsMachine *the) {
 AvdsFace *self=checkedFace(the); AvdsFaceState *s=(*self)->engine;
 if (!s) return; xsmcVars(1); xsResult=xsmcNewObject();
#define STAT(name,value) do { xsmcSetNumber(xsVar(0),(double)(value)); xsmcSet(xsResult,xsID(name),xsVar(0)); } while (0)
 STAT("evaluations",s->evaluations); STAT("updates",s->updates); STAT("ticks",s->ticks);
 STAT("preparations",s->preparations); STAT("rasterPasses",s->rasterPasses); STAT("failures",s->failures);
 STAT("geometryChanges",s->geometryChanges); STAT("vmUs",s->vmUs); STAT("geometryUs",s->geometryUs);
 STAT("rasterSubmitUs",s->rasterSubmitUs); STAT("elapsed",s->elapsed); STAT("nativeBytes",sizeof(*s));
 STAT("rasterUs",s->rasterUs);
 STAT("instructions",s->vm.steps); STAT("commands",s->count); STAT("disposed",s->disposed);
#undef STAT
}
typedef struct { AvdsProgram *program; AvdsVM vm; uint32_t instructions, runs; uint16_t draws; uint64_t vmUs; } AvdsVMState;
void xs_avds_vm_delete(void *it) { AvdsVMState *s=it; if (s) { avds_program_delete(s->program); free(s); vmAllocations--; } }
void xs_avds_vm_create(xsMachine *the) {
 AvdsVMState *s=calloc(1,sizeof(*s)); if (!s) xsUnknownError("AVDS: allocation"); xsmcSetHostData(xsThis,s); vmAllocations++;
 budgets(the,xsArg(1),xsArg(2),&s->instructions,&s->draws);
 AvdsError e; s->program=readProgram(the,xsArg(0),&e);
 if (!s->program) xsRangeError("AVDS: %s",avds_error_string(e));
}
void xs_avds_vm_run(xsMachine *the) {
 AvdsVMState *s=xsmcGetHostDataValidate(xsThis,xs_avds_vm_delete); if (!s || !s->program) xsUnknownError("AVDS: disposed");
 float ctx[AVDS_CONTEXT]; readContext(the,xsArg(0),ctx);
 void *commands; xsUnsignedValue n; xsmcGetBufferWritable(xsArg(1),&commands,&n);
 if (n<sizeof(s->vm.commands)) xsRangeError("AVDS: commands size");
 uint64_t start=nowUs();
 AvdsError e=avds_run(&s->vm,s->program,ctx,s->instructions,s->draws);
 s->vmUs+=durationUs(start); s->runs++;
 if (e) xsRangeError("AVDS: %s",avds_error_string(e));
 memcpy(commands,s->vm.commands,s->vm.count*sizeof(s->vm.commands[0])); xsResult=xsInteger(s->vm.count);
}
void xs_avds_vm_steps(xsMachine *the) { AvdsVMState *s=xsmcGetHostDataValidate(xsThis,xs_avds_vm_delete); if (!s) xsUnknownError("AVDS: disposed"); xsResult=xsInteger(s->vm.steps); }
void xs_avds_vm_stats(xsMachine *the) {
 AvdsVMState *s=xsmcGetHostDataValidate(xsThis,xs_avds_vm_delete); if (!s) xsUnknownError("AVDS: disposed");
 xsmcVars(1); xsResult=xsmcNewObject();
 xsmcSetNumber(xsVar(0),(double)s->vmUs); xsmcSet(xsResult,xsID("vmUs"),xsVar(0));
 xsmcSetUnsigned(xsVar(0),s->runs); xsmcSet(xsResult,xsID("runs"),xsVar(0));
}
void xs_avds_vm_close(xsMachine *the) { AvdsVMState *s=xsmcGetHostDataValidate(xsThis,xs_avds_vm_delete); xsmcSetHostData(xsThis,NULL); xs_avds_vm_delete(s); }
void xs_avds_allocations(xsMachine *the) {
 xsmcVars(1); xsResult=xsmcNewObject();
 xsmcSetUnsigned(xsVar(0),faceAllocations); xsmcSet(xsResult,xsID("faces"),xsVar(0));
 xsmcSetUnsigned(xsVar(0),vmAllocations); xsmcSet(xsResult,xsID("vms"),xsVar(0));
}
