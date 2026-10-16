// SPDX-License-Identifier: Apache-2.0
// Binary batch adapter. Each case: byte count, instruction budget, draw budget,
// 41 float32 context values, then bytecode. No XS/Piu or device dependencies.
#include "avds-engine.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
 uint32_t header[3]; float ctx[AVDS_CONTEXT]; AvdsVM vm;
 while (fread(header,sizeof(header),1,stdin)==1) {
  if (header[0]>70001 || fread(ctx,sizeof(ctx),1,stdin)!=1) return 2;
  uint8_t *bytes=malloc(header[0]?header[0]:1);
  if (!bytes || fread(bytes,1,header[0],stdin)!=header[0]) return 3;
  AvdsError error; AvdsProgram *p=avds_program_create(bytes,header[0],&error);
  // The engine must retain an immutable snapshot, not a caller-owned pointer.
  memset(bytes,0,header[0]); free(bytes); memset(&vm,0,sizeof(vm));
  if (p) error=avds_run(&vm,p,ctx,header[1],(uint16_t)header[2]);
  printf("{\"error\":%u,\"message\":\"%s\",\"steps\":%u,\"commands\":[",error,avds_error_string(error),vm.steps);
  for (unsigned i=0;i<vm.count;i++) {
   if (i) putchar(',');
   putchar('[');
   for (unsigned j=0;j<AVDS_STRIDE;j++) printf("%s%d",j?",":"",vm.commands[i][j]);
   putchar(']');
  }
  puts("]}"); avds_program_delete(p);
 }
 return ferror(stdin)?4:0;
}
