// SPDX-License-Identifier: Apache-2.0
#include "avds-render.h"
#include <string.h>
static int32_t minimum(int32_t a, int32_t b) { return a<b?a:b; }
static int32_t maximum(int32_t a, int32_t b) { return a>b?a:b; }
static AvdsRect intersect(AvdsRect a, AvdsRect b) {
 int32_t x=maximum(a.x,b.x), y=maximum(a.y,b.y);
 int32_t right=minimum(a.x+a.w,b.x+b.w), bottom=minimum(a.y+a.h,b.y+b.h);
 if (!a.w || !a.h || !b.w || !b.h || right<=x || bottom<=y) return (AvdsRect){0,0,0,0};
 return (AvdsRect){x,y,right-x,bottom-y};
}
static AvdsRect unite(AvdsRect a, AvdsRect b) {
 if (!a.w || !a.h) return b;
 if (!b.w || !b.h) return a;
 int32_t x=minimum(a.x,b.x), y=minimum(a.y,b.y);
 return (AvdsRect){x,y,maximum(a.x+a.w,b.x+b.w)-x,maximum(a.y+a.h,b.y+b.h)-y};
}
AvdsError avds_render_prepare(const int32_t commands[][AVDS_STRIDE], unsigned count,
 int32_t width, int32_t height, AvdsRenderFrame *frame) {
 AvdsRect stack[AVDS_GROUPS+1]; unsigned depth=0;
 frame->count=0;
 if (count>AVDS_COMMANDS || width<1 || width>1024 || height<1 || height>1024) return AVDS_CONTEXT_ERROR;
 stack[0]=(AvdsRect){0,0,width,height};
 for (unsigned i=0;i<count;i++) {
  const int32_t *c=commands[i];
  // VM validation bounds every operand before this arithmetic. Check here too
  // so standalone planning cannot overflow or publish a malformed clip frame.
  for (unsigned j=1;j<7;j++) if (c[j]<-32768 || c[j]>32767) return AVDS_COORDINATE;
  if (c[0]==AVDS_BEGIN) {
   if (depth==AVDS_GROUPS) return AVDS_GROUP;
   if (c[3]<0 || c[4]<0) return AVDS_EXTENT;
   AvdsRect clip=intersect(stack[depth],(AvdsRect){c[1],c[2],c[3],c[4]});
   stack[++depth]=clip; continue;
  }
  if (c[0]==AVDS_END) { if (!depth) return AVDS_GROUP; depth--; continue; }
  int32_t x=c[1],y=c[2],right,bottom;
  if (c[0]==AVDS_RECT) {
   if (c[3]<0 || c[4]<0) return AVDS_EXTENT;
   if (!c[3] || !c[4]) continue;
   right=x+c[3]; bottom=y+c[4];
  } else if (c[0]==AVDS_CIRCLE) {
   if (c[3]<0) return AVDS_EXTENT;
   if (!c[3]) continue;
   right=x+c[3]; bottom=y+c[3]; x-=c[3]; y-=c[3];
  } else if (c[0]==AVDS_TRIANGLE) {
   right=maximum(x,maximum(c[3],c[5])); bottom=maximum(y,maximum(c[4],c[6]));
   x=minimum(x,minimum(c[3],c[5])); y=minimum(y,minimum(c[4],c[6]));
  } else return AVDS_OPCODE;
  if (frame->count==AVDS_OUTLINES) return AVDS_PRIMITIVES;
  AvdsPrimitive *p=frame->primitives+frame->count++;
  p->command=(uint16_t)i; p->clip=stack[depth];
  // Conservative one-pixel AA fringe, clipped AFTER expansion. Never expand
  // the declared group. The cubic circle control hull stays inside its radius.
  p->bounds=intersect((AvdsRect){x-1,y-1,right-x+2,bottom-y+2},p->clip);
 }
 return depth?AVDS_GROUP:AVDS_OK;
}
static int samePrimitive(const int32_t oldCommands[][AVDS_STRIDE], const AvdsPrimitive *a,
 const int32_t newCommands[][AVDS_STRIDE], const AvdsPrimitive *b) {
 return !memcmp(&a->clip,&b->clip,sizeof(AvdsRect)) &&
  !memcmp(oldCommands[a->command],newCommands[b->command],AVDS_STRIDE*sizeof(int32_t));
}
AvdsRect avds_render_damage(const int32_t oldCommands[][AVDS_STRIDE], const AvdsRenderFrame *oldFrame,
 const int32_t newCommands[][AVDS_STRIDE], const AvdsRenderFrame *newFrame) {
 AvdsRect damage={0,0,0,0};
 unsigned start=0,oldEnd=oldFrame->count,newEnd=newFrame->count;
 // An inserted/removed eye primitive must not dirty an identical trailing
 // collar or cheek just because its command/Outline index shifted. Preserve
 // common prefix/suffix order; reordered middle primitives remain damaged.
 while (start<oldEnd && start<newEnd && samePrimitive(oldCommands,oldFrame->primitives+start,newCommands,newFrame->primitives+start)) start++;
 while (oldEnd>start && newEnd>start && samePrimitive(oldCommands,oldFrame->primitives+oldEnd-1,newCommands,newFrame->primitives+newEnd-1)) { oldEnd--; newEnd--; }
 unsigned count=maximum(oldEnd-start,newEnd-start);
 for (unsigned i=0;i<count;i++) {
  const AvdsPrimitive *a=start+i<oldEnd?oldFrame->primitives+start+i:NULL;
  const AvdsPrimitive *b=start+i<newEnd?newFrame->primitives+start+i:NULL;
  if (a && b && samePrimitive(oldCommands,a,newCommands,b)) continue;
  if (a) damage=unite(damage,a->bounds);
  if (b) damage=unite(damage,b->bounds);
 }
 return damage;
}
