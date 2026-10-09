// SPDX-License-Identifier: Apache-2.0
#include "avds-render.h"
#include <stdio.h>
#include <string.h>
#include <time.h>
int main(void) {
 int32_t commands[AVDS_COMMANDS][AVDS_STRIDE],previous[AVDS_COMMANDS][AVDS_STRIDE]={{0}};
 AvdsRenderFrame frame,old={0}; uint32_t header[3];
 while (fread(header,sizeof(header),1,stdin)==1) {
  if (header[0]>AVDS_COMMANDS || fread(commands,sizeof(commands[0]),header[0],stdin)!=header[0]) return 2;
  AvdsError error=avds_render_prepare(commands,header[0],header[1],header[2],&frame);
  printf("{\"error\":%u",error);
  if (!error) {
   AvdsRect damage=avds_render_damage(previous,&old,commands,&frame);
   // Amortize the host CPU clock over repeated actual planning calls. The
   // independent translation unit and volatile sink prevent dead-code removal.
   volatile uint64_t sink=0;
   clock_t started=clock();
   for (unsigned repeat=0;repeat<64;repeat++) {
    if (avds_render_prepare(commands,header[0],header[1],header[2],&frame)) return 3;
    AvdsRect measured=avds_render_damage(previous,&old,commands,&frame);
    sink+=(uint64_t)measured.w*measured.h;
   }
   double cpuUs=(double)(clock()-started)*1000000/CLOCKS_PER_SEC;
   printf(",\"plannerCpuUs\":%.3f,\"plannerRuns\":64,\"damage\":[%d,%d,%d,%d],\"primitives\":[",cpuUs,damage.x,damage.y,damage.w,damage.h);
   (void)sink;
   for (unsigned i=0;i<frame.count;i++) {
    AvdsPrimitive *p=frame.primitives+i;
    printf("%s{\"command\":%u,\"clip\":[%d,%d,%d,%d],\"bounds\":[%d,%d,%d,%d]}",i?",":"",p->command,
     p->clip.x,p->clip.y,p->clip.w,p->clip.h,p->bounds.x,p->bounds.y,p->bounds.w,p->bounds.h);
   }
   printf("]"); old=frame; memcpy(previous,commands,sizeof(previous));
  }
  puts("}");
 }
 return ferror(stdin)?2:0;
}
