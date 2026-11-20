// SPDX-License-Identifier: Apache-2.0
#ifndef STACKCHAN_AVDS_OUTLINE_H
#define STACKCHAN_AVDS_OUTLINE_H
#include "avds-engine.h"
#include <math.h>
// Shared firmware/WASM geometry in signed 26.6 coordinates. Keep storage
// independent of FT_Pos's host ABI, then copy into the rasterizer's vectors.
static unsigned avds_outline_points(const int32_t *c, int32_t p[26], uint8_t tags[13]) {
 unsigned n=c[0]==AVDS_RECT?4:c[0]==AVDS_TRIANGLE?3:13;
 if (c[0]==AVDS_RECT) {
  int32_t xy[8]={c[1],c[2],c[1]+c[3],c[2],c[1]+c[3],c[2]+c[4],c[1],c[2]+c[4]};
  for (unsigned i=0;i<8;i++) p[i]=xy[i]*64;
  for (unsigned i=0;i<n;i++) tags[i]=1;
 } else if (c[0]==AVDS_TRIANGLE) {
  for (unsigned i=0;i<6;i++) p[i]=c[i+1]*64;
  for (unsigned i=0;i<n;i++) tags[i]=1;
 } else {
  const double pi=3.14159265358979323846, delta=pi/2, ratio=(4*tan(delta/4))/3;
  double theta=0, x1=cos(theta), y1=sin(theta);
  p[0]=(int32_t)((c[3]*x1+c[1])*64); p[1]=(int32_t)((c[3]*y1+c[2])*64); tags[0]=1;
  for (unsigned i=0;i<4;i++) {
   theta+=delta; double x2=cos(theta), y2=sin(theta);
   unsigned j=2+i*6;
   p[j]=(int32_t)((c[3]*(x1-y1*ratio)+c[1])*64);
   p[j+1]=(int32_t)((c[3]*(y1+x1*ratio)+c[2])*64);
   p[j+2]=(int32_t)((c[3]*(x2+y2*ratio)+c[1])*64);
   p[j+3]=(int32_t)((c[3]*(y2-x2*ratio)+c[2])*64);
   p[j+4]=(int32_t)((c[3]*x2+c[1])*64); p[j+5]=(int32_t)((c[3]*y2+c[2])*64);
   tags[1+i*3]=tags[2+i*3]=2; tags[3+i*3]=1; x1=x2; y1=y2;
  }
 }
 return n;
}
#endif
