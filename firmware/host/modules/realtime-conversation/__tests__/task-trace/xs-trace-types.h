#pragma once
// Test-only compatibility: retain SEGGER types without globally expanding XS
// token-pasting arguments such as U32. No SDK source is changed.
#include "SEGGER_SYSVIEW.h"
typedef U8 StackchanTraceU8;
#undef U8
typedef StackchanTraceU8 U8;
typedef I8 StackchanTraceI8;
#undef I8
typedef StackchanTraceI8 I8;
typedef U16 StackchanTraceU16;
#undef U16
typedef StackchanTraceU16 U16;
typedef I16 StackchanTraceI16;
#undef I16
typedef StackchanTraceI16 I16;
typedef U32 StackchanTraceU32;
#undef U32
typedef StackchanTraceU32 U32;
typedef I32 StackchanTraceI32;
#undef I32
typedef StackchanTraceI32 I32;
typedef U64 StackchanTraceU64;
#undef U64
typedef StackchanTraceU64 U64;
typedef I64 StackchanTraceI64;
#undef I64
typedef StackchanTraceI64 I64;
