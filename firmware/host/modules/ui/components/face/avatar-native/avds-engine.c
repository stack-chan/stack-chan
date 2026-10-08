// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
// Native, bounded adaptation of ciniml/stackchan-idf avatar_vm at
// 419385ef1b875137140085bd50d34dee331f30c2. See PROVENANCE.md.
#include "avds-engine.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(sizeof(float)==4 && sizeof(int32_t)==4,"AVDS requires 32-bit float and integer storage");

typedef struct { uint16_t start; uint8_t params, locals; } AvdsFunction;
struct AvdsProgram {
 uint8_t *bytes;
 const uint8_t *code;
 float constants[256];
 AvdsFunction functions[256];
 uint16_t codeSize, functionCount, entry;
};
static uint16_t u16(const uint8_t *p) { return p[0] | ((uint16_t)p[1] << 8); }
static uint32_t u32(const uint8_t *p) { return u16(p) | ((uint32_t)u16(p+2) << 16); }
static float f32(const uint8_t *p) { uint32_t bits=u32(p); float v; memcpy(&v,&bits,4); return v; }
// Prevent contraction/excess precision across the pinned C++ float operations.
static float rounded(float v) { volatile float result=v; return result; }
static int width(uint8_t op) {
 switch (op) {
 case AVDS_F32: return 4;
 case AVDS_I16: case AVDS_JMP: case AVDS_JZ: case AVDS_JNZ: return 2;
 case AVDS_I8: case AVDS_CONST: case AVDS_VAR: case AVDS_LOCAL: case AVDS_STORE: case AVDS_CALL: return 1;
 case AVDS_NOP: case AVDS_POP: case AVDS_DUP:
 case AVDS_ADD: case AVDS_SUB: case AVDS_MUL: case AVDS_DIV: case AVDS_NEG:
 case AVDS_MIN: case AVDS_MAX: case AVDS_ABS: case AVDS_FLOOR: case AVDS_ROUND:
 case AVDS_MOD: case AVDS_SQRT: case AVDS_CLAMP: case AVDS_SCALE: case AVDS_TX: case AVDS_TY:
 case AVDS_EQ: case AVDS_NE: case AVDS_LT: case AVDS_LE: case AVDS_GT: case AVDS_GE:
 case AVDS_NOT: case AVDS_AND: case AVDS_OR: case AVDS_XOR: case AVDS_RET:
 case AVDS_RECT: case AVDS_CIRCLE: case AVDS_TRIANGLE: case AVDS_BEGIN: case AVDS_END: return 0;
 default: return -1;
 }
}
void avds_program_delete(AvdsProgram *p) { if (p) { free(p->bytes); free(p); } }
AvdsProgram *avds_program_create(const void *data, size_t size, AvdsError *error) {
 AvdsError e=AVDS_FILE;
 AvdsProgram *p=NULL;
 uint8_t *boundary=NULL, *seen=NULL;
 uint16_t *pending=NULL;
 uint32_t offset=16, pc;
 uint16_t nc, nf, cs, entry;
 if (!data || size<16 || size>70000) goto fail;
 p=calloc(1,sizeof(*p));
 e=AVDS_MEMORY;
 if (!p || !(p->bytes=malloc(size))) goto fail;
 memcpy(p->bytes,data,size);
 // Header and sections must be validated from the same owned snapshot.
 const uint8_t *input=p->bytes;
 e=AVDS_HEADER;
 if (u32(input)!=0x53445641 || u16(input+4)!=1 || u16(input+6)) goto fail;
 nc=u16(input+8); nf=u16(input+10); cs=u16(input+12); entry=u16(input+14);
 if (nc>256 || !nf || nf>256 || !cs || entry>=nf) goto fail;
 p->codeSize=cs; p->functionCount=nf; p->entry=entry;
 e=AVDS_SECTIONS;
 for (uint16_t i=0; i<nc; i++) {
  if (offset>=size) goto fail;
  uint8_t tag=input[offset++];
  uint32_t n=tag==3 ? 2 : 4;
  if (tag<1 || tag>3 || offset+n>size) goto fail;
  float v=tag==1 ? f32(input+offset) : tag==2 ? (float)(int32_t)u32(input+offset) : (float)u16(input+offset);
  e=AVDS_NONFINITE; if (!isfinite(v)) goto fail;
  p->constants[i]=v; offset+=n; e=AVDS_SECTIONS;
 }
 if (offset+(uint32_t)nf*6+cs!=size) goto fail;
 for (uint16_t i=0; i<nf; i++,offset+=6) {
  AvdsFunction *f=p->functions+i;
  f->start=u16(input+offset); f->params=input[offset+2]; f->locals=input[offset+3];
  if (f->start>=cs || f->locals<f->params || u16(input+offset+4)) goto fail;
 }
 if (p->functions[entry].params) goto fail;
 p->code=input+offset;
 e=AVDS_MEMORY;
 boundary=calloc(cs,1); seen=malloc(cs); pending=malloc((size_t)cs*sizeof(*pending));
 if (!boundary || !seen || !pending) goto fail;
 for (pc=0; pc<cs;) {
  boundary[pc]=1;
  uint8_t op=p->code[pc++]; int n=width(op);
  e=AVDS_OPCODE; if (n<0 || pc+(uint32_t)n>cs) goto fail;
  e=AVDS_NONFINITE; if (op==AVDS_F32 && !isfinite(f32(p->code+pc))) goto fail;
  e=AVDS_REFERENCE;
  if ((op==AVDS_CONST && p->code[pc]>=nc) || (op==AVDS_VAR && p->code[pc]>=AVDS_CONTEXT) ||
      (op==AVDS_CALL && p->code[pc]>=nf)) goto fail;
  pc+=(uint32_t)n;
 }
 e=AVDS_CONTROL;
 for (uint16_t i=0; i<nf; i++) if (!boundary[p->functions[i].start]) goto fail;
 for (pc=0; pc<cs;) {
  uint8_t op=p->code[pc++]; int n=width(op);
  if (op==AVDS_JMP || op==AVDS_JZ || op==AVDS_JNZ) {
   int32_t target=(int32_t)pc+n+(int16_t)u16(p->code+pc);
   if (target<0 || target>=cs || !boundary[target]) goto fail;
  }
  pc+=(uint32_t)n;
 }
 // Validate each function's reachable local references and fallthrough.
 // Enqueue once, so both visits and worklist are bounded by codeSize/function.
 for (uint16_t i=0; i<nf; i++) {
  uint32_t length=1;
  memset(seen,0,cs); pending[0]=p->functions[i].start; seen[pending[0]]=1;
  while (length) {
   uint32_t start=pending[--length]; uint8_t op=p->code[start];
   uint32_t after=start+1+(uint32_t)width(op);
   e=AVDS_REFERENCE;
   if ((op==AVDS_LOCAL || op==AVDS_STORE) && p->code[start+1]>=p->functions[i].locals) goto fail;
   if (op==AVDS_RET) continue;
   int32_t next[2]; unsigned count=0;
   if (op==AVDS_JMP || op==AVDS_JZ || op==AVDS_JNZ) next[count++]=(int32_t)after+(int16_t)u16(p->code+start+1);
   if (op!=AVDS_JMP) next[count++]=(int32_t)after;
   for (unsigned j=0; j<count; j++) {
    e=AVDS_CONTROL;
    if (next[j]<0 || next[j]>=cs || !boundary[next[j]]) goto fail;
    if (!seen[next[j]]) { seen[next[j]]=1; pending[length++]=(uint16_t)next[j]; }
   }
  }
 }
 free(boundary); free(seen); free(pending); *error=AVDS_OK; return p;
fail:
 free(boundary); free(seen); free(pending); avds_program_delete(p); *error=e; return NULL;
}

AvdsError avds_run(AvdsVM *vm, const AvdsProgram *p, const float ctx[AVDS_CONTEXT], uint32_t budget, uint16_t draws) {
 AvdsError error=AVDS_OK;
 uint32_t pc, depth=1, base=0, size, sp=0, groups=0;
 const uint8_t *code=p->code;
 float *s=vm->stack, *locals=vm->locals;
 vm->count=0; vm->steps=0;
#define REQUIRE(test, err) do { if (!(test)) { error=(err); goto fail; } } while (0)
#define POP(v) do { REQUIRE(sp,AVDS_STACK); (v)=s[--sp]; } while (0)
#define PUSH(v) do { float value=rounded(v); REQUIRE(isfinite(value),AVDS_NONFINITE); REQUIRE(sp<64,AVDS_STACK); s[sp++]=value; } while (0)
 REQUIRE(budget>=1 && budget<=50000 && draws>=1 && draws<=AVDS_COMMANDS,AVDS_CONTEXT_ERROR);
 for (unsigned i=0;i<AVDS_CONTEXT;i++) REQUIRE(isfinite(ctx[i]),AVDS_NONFINITE);
 REQUIRE(ctx[0]>=1 && ctx[0]<=1024 && ctx[1]>=1 && ctx[1]<=1024 && ctx[2]>0,AVDS_CONTEXT_ERROR);
 pc=p->functions[p->entry].start; size=p->functions[p->entry].locals;
 vm->frames[0]=(AvdsFrame){0,0,(uint16_t)size}; memset(locals,0,size*sizeof(float));
 for (;;) {
  REQUIRE(++vm->steps<=budget,AVDS_INSTRUCTIONS);
  REQUIRE(pc<p->codeSize,AVDS_CONTROL);
  uint8_t op=code[pc++]; float a=0,b=0,v=0; int push=1;
  switch (op) {
  case AVDS_NOP: push=0; break;
  case AVDS_F32: v=f32(code+pc); pc+=4; break;
  case AVDS_I8: v=(int8_t)code[pc++]; break;
  case AVDS_I16: v=(int16_t)u16(code+pc); pc+=2; break;
  case AVDS_CONST: v=p->constants[code[pc++]]; break;
  case AVDS_VAR: v=ctx[code[pc++]]; break;
  case AVDS_LOCAL: case AVDS_STORE: {
   uint8_t slot=code[pc++]; REQUIRE(slot<size,AVDS_LOCALS);
   if (op==AVDS_LOCAL) v=locals[base+slot]; else { POP(v); locals[base+slot]=v; push=0; }
   break;
  }
  case AVDS_POP: POP(v); push=0; break;
  case AVDS_DUP: REQUIRE(sp,AVDS_STACK); v=s[sp-1]; break;
  case AVDS_ADD: case AVDS_SUB: case AVDS_MUL: case AVDS_DIV: case AVDS_MIN: case AVDS_MAX:
  case AVDS_MOD: case AVDS_EQ: case AVDS_NE: case AVDS_LT: case AVDS_LE: case AVDS_GT: case AVDS_GE:
  case AVDS_AND: case AVDS_OR: case AVDS_XOR:
   POP(b); POP(a);
   switch (op) {
   case AVDS_ADD: v=a+b; break; case AVDS_SUB: v=a-b; break; case AVDS_MUL: v=a*b; break;
   case AVDS_DIV: REQUIRE(b!=0,AVDS_DIV_ZERO); v=a/b; break;
   case AVDS_MIN: v=b<a?b:a; break; case AVDS_MAX: v=a<b?b:a; break;
   case AVDS_MOD: REQUIRE(b!=0,AVDS_DIV_ZERO); v=fmodf(a,b); break;
   case AVDS_EQ: v=a==b; break; case AVDS_NE: v=a!=b; break; case AVDS_LT: v=a<b; break;
   case AVDS_LE: v=a<=b; break; case AVDS_GT: v=a>b; break; case AVDS_GE: v=a>=b; break;
   case AVDS_AND: v=a!=0 && b!=0; break; case AVDS_OR: v=a!=0 || b!=0; break;
   case AVDS_XOR: v=(a!=0)!=(b!=0); break;
   }
   break;
  case AVDS_NEG: case AVDS_ABS: case AVDS_FLOOR: case AVDS_ROUND: case AVDS_SQRT: case AVDS_NOT:
  case AVDS_SCALE: case AVDS_TX: case AVDS_TY:
   POP(a);
   switch (op) {
   case AVDS_NEG: v=-a; break; case AVDS_ABS: v=fabsf(a); break; case AVDS_FLOOR: v=floorf(a); break;
   case AVDS_ROUND: v=roundf(a); break; case AVDS_SQRT: v=sqrtf(a); break; case AVDS_NOT: v=a==0; break;
   case AVDS_SCALE: v=rounded(a*ctx[2]); if (v<1) v=1; break;
   case AVDS_TX: v=rounded(ctx[0]/2)+rounded(rounded(a-160)*ctx[2]); break;
   case AVDS_TY: v=rounded(ctx[1]/2)+rounded(rounded(a-120)*ctx[2]); break;
   }
   break;
  case AVDS_CLAMP: POP(b); POP(a); POP(v); v=v<a?a:v>b?b:v; break;
  case AVDS_JMP: case AVDS_JZ: case AVDS_JNZ: {
   int16_t offset=(int16_t)u16(code+pc); pc+=2;
   if (op!=AVDS_JMP) POP(a);
   if (op==AVDS_JMP || (op==AVDS_JZ ? a==0 : a!=0)) pc=(uint32_t)((int32_t)pc+offset);
   push=0; break;
  }
  case AVDS_CALL: {
   const AvdsFunction *fn=p->functions+code[pc++]; uint32_t nextBase=base+size;
   REQUIRE(depth<16,AVDS_CALL_DEPTH); REQUIRE(nextBase+fn->locals<=256,AVDS_LOCALS);
   REQUIRE(sp>=fn->params,AVDS_STACK);
   for (int i=fn->params-1;i>=0;i--) locals[nextBase+(unsigned)i]=s[--sp];
   memset(locals+nextBase+fn->params,0,(fn->locals-fn->params)*sizeof(float));
   vm->frames[depth]=(AvdsFrame){pc,(uint16_t)nextBase,fn->locals}; depth++;
   base=nextBase; size=fn->locals; pc=fn->start; push=0; break;
  }
  case AVDS_RET:
   if (--depth==0) { REQUIRE(!groups,AVDS_GROUP); return AVDS_OK; }
   pc=vm->frames[depth].pc; base=vm->frames[depth-1].base; size=vm->frames[depth-1].size;
   push=0; break;
  case AVDS_RECT: case AVDS_CIRCLE: case AVDS_TRIANGLE: case AVDS_BEGIN: case AVDS_END: {
   unsigned n=op==AVDS_RECT || op==AVDS_BEGIN?4:op==AVDS_CIRCLE?3:op==AVDS_TRIANGLE?6:0;
   int color=op==AVDS_RECT || op==AVDS_CIRCLE || op==AVDS_TRIANGLE;
   REQUIRE(vm->count<draws,AVDS_DRAWS); REQUIRE(sp>=n+(unsigned)color,AVDS_STACK);
   if (op==AVDS_BEGIN) REQUIRE(++groups<=16,AVDS_GROUP);
   if (op==AVDS_END) { REQUIRE(groups,AVDS_GROUP); groups--; }
   int32_t *c=vm->commands[vm->count]; memset(c,0,AVDS_STRIDE*sizeof(int32_t)); c[0]=op;
   if (color) { POP(v); v=truncf(v); REQUIRE(v>=0 && v<=65535,AVDS_COLOR); c[7]=(int32_t)v; }
   for (unsigned i=n;i;i--) { POP(v); v=truncf(v); REQUIRE(v>=-32768 && v<=32767,AVDS_COORDINATE); c[i]=(int32_t)v; }
   REQUIRE(!((op==AVDS_CIRCLE && c[3]<0) || ((op==AVDS_RECT || op==AVDS_BEGIN) && (c[3]<0 || c[4]<0))),AVDS_EXTENT);
   vm->count++; push=0; break;
  }
  default: error=AVDS_OPCODE; goto fail;
  }
  if (push) PUSH(v);
 }
fail:
 vm->count=0; return error;
#undef REQUIRE
#undef POP
#undef PUSH
}
const char *avds_error_string(AvdsError e) {
 static const char *messages[]={"ok","allocation","file size","version/flags/counts","sections",
  "opcode/operand","reference","jump/fallthrough","non-finite value","context/budget",
  "instruction budget","stack","locals","call depth","draw budget","group depth",
  "division by zero","coordinate range","color range","negative extent","Piu primitive budget"};
 return (unsigned)e<sizeof(messages)/sizeof(messages[0])?messages[e]:"unknown";
}
