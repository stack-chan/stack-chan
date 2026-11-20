// SPDX-License-Identifier: Apache-2.0
#include <stdio.h>
#include "bridge.c"
int main(void) {
 uint32_t header[3];
 while (fread(header,sizeof(header),1,stdin)==1) {
  if (header[0]>WEB_BYTES || fread(context,sizeof(context),1,stdin)!=1 ||
      fread(bytes,1,header[0],stdin)!=header[0]) return 2;
  unsigned error=web_run(header[0],header[1],header[2]);
  uint32_t result[4]={error,error?0:vm.count,error?0:frame.count,vm.steps};
  fwrite(result,sizeof(result),1,stdout);
  if (!error) {
   fwrite(vm.commands,sizeof(vm.commands[0]),vm.count,stdout);
   fwrite(plan,sizeof(plan[0]),frame.count,stdout);
   fwrite(rgba,4,width*height,stdout);
  }
 }
 return ferror(stdin)?2:0;
}
