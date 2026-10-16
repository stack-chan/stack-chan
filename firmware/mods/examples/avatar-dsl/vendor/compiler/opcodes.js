// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
//
// Mirror of components/avatar_vm/include/avatar_vm/opcodes.hpp. Keep in sync.
// The bytecode header pins MAGIC + VERSION; the VM rejects mismatched files.

export const MAGIC = 0x53445641; // "AVDS" little-endian
export const VERSION = 1;

export const Op = Object.freeze({
  Nop: 0x00,

  PushF32: 0x01,
  PushI8: 0x02,
  PushI16: 0x03,
  PushConst: 0x04,
  PushVar: 0x05,
  PushLocal: 0x06,
  StoreLocal: 0x07,
  Pop: 0x08,
  Dup: 0x09,

  Add: 0x10, Sub: 0x11, Mul: 0x12, Div: 0x13,
  Neg: 0x14, Min: 0x15, Max: 0x16,
  Abs: 0x17, Floor: 0x18, Round: 0x19,
  Mod: 0x1A, Sqrt: 0x1B,
  Clamp: 0x1C, Scale: 0x1D, Tx: 0x1E, Ty: 0x1F,

  Eq: 0x20, Ne: 0x21, Lt: 0x22, Le: 0x23, Gt: 0x24, Ge: 0x25,
  Not: 0x26, And: 0x27, Or: 0x28, Xor: 0x29,

  Jmp: 0x30, Jz: 0x31, Jnz: 0x32,
  Call: 0x33, Ret: 0x34,

  FillRect: 0x40,
  FillCircle: 0x41,
  FillTriangle: 0x42,
  BeginGroup: 0x45,
  EndGroup: 0x46,
});

// Context variable IDs.
export const Var = Object.freeze({
  canvas_w: 0x00,
  canvas_h: 0x01,
  canvas_scale: 0x02,
  now_ms: 0x03,
  breath: 0x04,
  eye_open: 0x05,
  gaze_h: 0x06,
  gaze_v: 0x07,
  mouth_open: 0x08,
  expr: 0x09,
  primary: 0x0A,
  background: 0x0B,
  secondary: 0x0C,
  balloon_fg: 0x0D,
  balloon_bg: 0x0E,
  eye_radius: 0x0F,
  eye_off_x: 0x10,
  eye_off_y: 0x11,
  brow_off_x: 0x12,
  brow_off_y: 0x13,
  mouth_off_x: 0x14,
  mouth_off_y: 0x15,
  mouth_min_w: 0x16,
  mouth_max_w: 0x17,
  mouth_min_h: 0x18,
  mouth_max_h: 0x19,
  eyebrows_visible: 0x1A,
  cheeks_visible: 0x1B,
  cheek_radius: 0x1C,
  cheek_off_x: 0x1D,
  cheek_off_y: 0x1E,
  mouth_form: 0x1F,
  // Accessory slots (FaceTuning::accessories bitmask). accessory_N is 0/1.
  accessories: 0x20,
  accessory_0: 0x21,
  accessory_1: 0x22,
  accessory_2: 0x23,
  accessory_3: 0x24,
  accessory_4: 0x25,
  accessory_5: 0x26,
  accessory_6: 0x27,
  accessory_7: 0x28,
});

export const ConstTag = Object.freeze({
  F32: 0x01,
  I32: 0x02,
  Color: 0x03,
  String: 0x04,
});

// Symbolic constants the parser inlines (expression enum, etc.). These match
// stackchan::avatar::Expression's declared order (Neutral, Happy, Sad, Angry,
// Doubt, Sleepy = 0..5).
export const SymbolicConsts = Object.freeze({
  NEUTRAL: 0,
  HAPPY: 1,
  SAD: 2,
  ANGRY: 3,
  DOUBT: 4,
  SLEEPY: 5,
  true: 1,
  false: 0,
});

// Built-in functions and the opcode they emit. Arity must match the VM's pop
// count exactly. `void` builtins push nothing.
export const Builtins = Object.freeze({
  // unary
  abs:   { op: Op.Abs,   arity: 1, returns: true  },
  floor: { op: Op.Floor, arity: 1, returns: true  },
  round: { op: Op.Round, arity: 1, returns: true  },
  sqrt:  { op: Op.Sqrt,  arity: 1, returns: true  },
  sz:    { op: Op.Scale, arity: 1, returns: true  },
  tx:    { op: Op.Tx,    arity: 1, returns: true  },
  ty:    { op: Op.Ty,    arity: 1, returns: true  },
  // binary
  min:   { op: Op.Min,   arity: 2, returns: true  },
  max:   { op: Op.Max,   arity: 2, returns: true  },
  // ternary
  clamp: { op: Op.Clamp, arity: 3, returns: true  },
  // drawing (void)
  fill_rect:     { op: Op.FillRect,     arity: 5, returns: false },
  fill_circle:   { op: Op.FillCircle,   arity: 4, returns: false },
  fill_triangle: { op: Op.FillTriangle, arity: 7, returns: false },
  begin_group:   { op: Op.BeginGroup,   arity: 4, returns: false },
  end_group:     { op: Op.EndGroup,     arity: 0, returns: false },
});
