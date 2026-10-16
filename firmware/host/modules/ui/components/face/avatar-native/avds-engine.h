// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
// Native, bounded adaptation of ciniml/stackchan-idf avatar_vm at
// 419385ef1b875137140085bd50d34dee331f30c2. See PROVENANCE.md.
#ifndef STACKCHAN_AVDS_ENGINE_H
#define STACKCHAN_AVDS_ENGINE_H
#include <stddef.h>
#include <stdint.h>

enum { AVDS_CONTEXT = 41, AVDS_COMMANDS = 96, AVDS_STRIDE = 8 };
enum {
 AVDS_NOP=0, AVDS_F32=1, AVDS_I8=2, AVDS_I16=3, AVDS_CONST=4, AVDS_VAR=5,
 AVDS_LOCAL=6, AVDS_STORE=7, AVDS_POP=8, AVDS_DUP=9,
 AVDS_ADD=0x10, AVDS_SUB, AVDS_MUL, AVDS_DIV, AVDS_NEG, AVDS_MIN, AVDS_MAX,
 AVDS_ABS, AVDS_FLOOR, AVDS_ROUND, AVDS_MOD, AVDS_SQRT, AVDS_CLAMP,
 AVDS_SCALE, AVDS_TX, AVDS_TY,
 AVDS_EQ=0x20, AVDS_NE, AVDS_LT, AVDS_LE, AVDS_GT, AVDS_GE, AVDS_NOT,
 AVDS_AND, AVDS_OR, AVDS_XOR,
 AVDS_JMP=0x30, AVDS_JZ, AVDS_JNZ, AVDS_CALL, AVDS_RET,
 AVDS_RECT=0x40, AVDS_CIRCLE, AVDS_TRIANGLE, AVDS_BEGIN=0x45, AVDS_END
};
typedef enum {
 AVDS_OK, AVDS_MEMORY, AVDS_FILE, AVDS_HEADER, AVDS_SECTIONS, AVDS_OPCODE,
 AVDS_REFERENCE, AVDS_CONTROL, AVDS_NONFINITE, AVDS_CONTEXT_ERROR,
 AVDS_INSTRUCTIONS, AVDS_STACK, AVDS_LOCALS, AVDS_CALL_DEPTH,
 AVDS_DRAWS, AVDS_GROUP, AVDS_DIV_ZERO, AVDS_COORDINATE, AVDS_COLOR,
 AVDS_EXTENT, AVDS_PRIMITIVES
} AvdsError;
typedef struct AvdsProgram AvdsProgram;
typedef struct { uint32_t pc; uint16_t base, size; } AvdsFrame;
typedef struct {
 float stack[64], locals[256];
 AvdsFrame frames[16];
 int32_t commands[AVDS_COMMANDS][AVDS_STRIDE];
 uint32_t steps;
 uint16_t count;
} AvdsVM;

AvdsProgram *avds_program_create(const void *bytes, size_t size, AvdsError *error);
void avds_program_delete(AvdsProgram *program);
AvdsError avds_run(AvdsVM *vm, const AvdsProgram *program, const float context[AVDS_CONTEXT],
 uint32_t instructions, uint16_t draws);
const char *avds_error_string(AvdsError error);
#endif
