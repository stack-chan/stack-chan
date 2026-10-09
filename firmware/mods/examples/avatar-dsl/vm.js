// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
// JavaScript adaptation of avatar_vm/decoder.cpp and vm.cpp at the pinned commit.
// See vendor/PROVENANCE.json. Stricter rejection/budgets are intentional.
import { Op, Var } from 'avatar-dsl/vendor/compiler/opcodes'

// Bind the pinned opcode table once: XS switches otherwise look up each
// case property for every instruction. Keep one authoritative opcode table.
const {
  PushF32,
  PushI8,
  PushConst,
  PushVar,
  PushLocal,
  StoreLocal,
  Call,
  PushI16,
  Jmp,
  Jz,
  Jnz,
  Ret,
  FillCircle,
  FillRect,
  BeginGroup,
  Nop,
  Pop,
  Dup,
  Add,
  Sub,
  Mul,
  Div,
  Min,
  Max,
  Mod,
  Eq,
  Ne,
  Lt,
  Le,
  Gt,
  Ge,
  And,
  Or,
  Xor,
  Neg,
  Abs,
  Floor,
  Round,
  Sqrt,
  Not,
  Scale,
  Tx,
  Ty,
  Clamp,
  FillTriangle,
  EndGroup,
} = Op

const arity = new Uint8Array(0x47)
arity[PushF32] = 4
for (const op of [PushI8, PushConst, PushVar, PushLocal, StoreLocal, Call]) arity[op] = 1
for (const op of [PushI16, Jmp, Jz, Jnz]) arity[op] = 2
const known = new Uint8Array(0x47)
for (const op of Object.values(Op)) known[op] = 1
const fail = (message) => {
  throw new Error(`AVDS: ${message}`)
}
const finite = (value) => {
  if (!Number.isFinite(value)) fail('non-finite value')
  return value
}

/** Own a snapshot: mutation of the caller's buffer cannot bypass validation. */
export function decode(buffer) {
  const inputSize = buffer?.byteLength ?? buffer?.length
  if (!Number.isInteger(inputSize) || inputSize < 16 || inputSize > 70000) fail('file size')
  const source = new Uint8Array(buffer)
  const size = source.length
  if (size < 16 || size > 70000) fail('file size')
  const bytes = source.slice()
  const view = new DataView(bytes.buffer)
  if (view.getUint32(0, true) !== 0x53445641) fail('magic')
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true)) fail('version/flags')
  const nc = view.getUint16(8, true),
    nf = view.getUint16(10, true)
  const codeSize = view.getUint16(12, true),
    entry = view.getUint16(14, true)
  if (nc > 256 || !nf || nf > 256 || entry >= nf || !codeSize) fail('table counts/entry')
  let offset = 16
  const constants = new Float32Array(nc)
  for (let i = 0; i < nc; i++) {
    if (offset >= size) fail('truncated constant')
    const tag = bytes[offset++],
      width = tag === 3 ? 2 : 4
    if (tag < 1 || tag > 3 || offset + width > size) fail('constant tag/size')
    constants[i] = finite(
      tag === 1
        ? view.getFloat32(offset, true)
        : tag === 2
          ? view.getInt32(offset, true)
          : view.getUint16(offset, true),
    )
    offset += width
  }
  if (offset + nf * 6 + codeSize !== size) fail('sections/trailing bytes')
  const functions = new Uint16Array(nf * 3)
  for (let i = 0; i < nf; i++, offset += 6) {
    const start = view.getUint16(offset, true),
      params = bytes[offset + 2],
      locals = bytes[offset + 3]
    if (start >= codeSize || locals < params || view.getUint16(offset + 4, true)) fail('function entry/locals/reserved')
    functions[i * 3] = start
    functions[i * 3 + 1] = params
    functions[i * 3 + 2] = locals
  }
  if (functions[entry * 3 + 1]) fail('entry parameters')
  const code = bytes.subarray(offset),
    cv = new DataView(bytes.buffer, offset, codeSize)
  const boundaries = new Uint8Array(codeSize)
  for (let pc = 0; pc < codeSize; ) {
    boundaries[pc] = 1
    const op = code[pc++],
      n = arity[op]
    if (!known[op] || pc + n > codeSize) fail('opcode/operand')
    if (op === PushF32) finite(cv.getFloat32(pc, true))
    if (op === PushConst && code[pc] >= nc) fail('constant reference')
    if (op === PushVar && code[pc] >= Object.keys(Var).length) fail('context reference')
    if (op === Call && code[pc] >= nf) fail('function reference')
    pc += n
  }
  for (let i = 0; i < nf; i++) if (!boundaries[functions[i * 3]]) fail('function boundary')
  // Functions may share code. Validate local references by the executing frame
  // at runtime rather than guessing function ends from declaration order.
  for (let pc = 0; pc < codeSize; ) {
    const op = code[pc++],
      n = arity[op]
    if (op === Jmp || op === Jz || op === Jnz) {
      const target = pc + n + cv.getInt16(pc, true)
      if (target < 0 || target >= codeSize || !boundaries[target]) fail('jump boundary')
    }
    pc += n
  }
  // Walk each function's control flow (calls validate their own frame separately).
  // Mark when queued to bound both the worklist and visits even for cyclic code.
  const visited = new Uint8Array(codeSize),
    pending = new Uint16Array(codeSize)
  for (let i = 0; i < nf; i++) {
    visited.fill(0)
    let length = 1
    pending[0] = functions[i * 3]
    visited[pending[0]] = 1
    const queue = (pc) => {
      if (pc >= codeSize || !boundaries[pc]) fail('function fallthrough')
      if (!visited[pc]) {
        visited[pc] = 1
        pending[length++] = pc
      }
    }
    while (length) {
      const start = pending[--length],
        op = code[start],
        after = start + 1 + arity[op]
      if ((op === PushLocal || op === StoreLocal) && code[start + 1] >= functions[i * 3 + 2]) fail('local reference')
      if (op === Ret) continue
      if (op === Jmp || op === Jz || op === Jnz) queue(after + cv.getInt16(start + 1, true))
      if (op !== Jmp) queue(after)
    }
  }
  // Predecode only after all byte offsets/control-flow references validate.
  // One opcode and one float32 operand per instruction; no objects per opcode.
  // The temporary byte-offset map and validation buffers are released here.
  let count = 0
  for (let pc = 0; pc < codeSize; pc += 1 + arity[code[pc]]) count++
  const opcodes = new Uint8Array(count),
    operands = new Float32Array(count),
    indices = new Uint16Array(codeSize)
  for (let pc = 0, i = 0; pc < codeSize; i++) {
    indices[pc] = i
    opcodes[i] = code[pc]
    pc += 1 + arity[code[pc]]
  }
  for (let pc = 0, i = 0; pc < codeSize; i++) {
    const op = code[pc++],
      n = arity[op]
    if (op === PushF32) operands[i] = cv.getFloat32(pc, true)
    else if (op === PushI8) operands[i] = cv.getInt8(pc)
    else if (op === PushI16) operands[i] = cv.getInt16(pc, true)
    else if (op === PushConst) operands[i] = constants[code[pc]]
    else if (op === Jmp || op === Jz || op === Jnz) operands[i] = indices[pc + n + cv.getInt16(pc, true)]
    else if (op === Call) operands[i] = code[pc] * 3
    else if (n) operands[i] = code[pc]
    pc += n
  }
  for (let i = 0; i < nf; i++) functions[i * 3] = indices[functions[i * 3]]
  return { opcodes, operands, functions, entry }
}

export const MAX_COMMANDS = 96
export const COMMAND_STRIDE = 8

/** Fixed numeric storage; renderer sees commands only after a successful frame. */
export class AvatarVM {
  constructor(buffer, { instructions = 12000, draws = MAX_COMMANDS } = {}) {
    if (
      !Number.isInteger(instructions) ||
      instructions < 1 ||
      instructions > 50000 ||
      !Number.isInteger(draws) ||
      draws < 1 ||
      draws > MAX_COMMANDS
    )
      fail('budget')
    this.program = decode(buffer)
    this.instructionBudget = instructions
    this.drawBudget = draws
    this.stack = new Float32Array(64)
    this.locals = new Float32Array(256)
    this.frames = new Uint16Array(16 * 3)
    this.commands = new Int32Array(MAX_COMMANDS * COMMAND_STRIDE)
    this.count = 0
    this.steps = 0
    this.sp = 0
  }
  emit(op, n, color, sp) {
    if (this.count >= this.drawBudget) fail('draw budget')
    if (sp < n + (color ? 1 : 0)) fail('stack underflow')
    const base = this.count * COMMAND_STRIDE,
      stack = this.stack,
      commands = this.commands
    commands.fill(0, base, base + COMMAND_STRIDE)
    commands[base] = op
    if (color) {
      const c = Math.trunc(stack[--sp])
      if (c < 0 || c > 65535) fail('color range')
      commands[base + 7] = c
    }
    for (let i = n; i >= 1; i--) {
      const v = Math.trunc(stack[--sp])
      if (v < -32768 || v > 32767) fail('coordinate range')
      commands[base + i] = v
    }
    if (
      (op === FillCircle && commands[base + 3] < 0) ||
      ((op === FillRect || op === BeginGroup) && (commands[base + 3] < 0 || commands[base + 4] < 0))
    )
      fail('negative extent')
    this.count++
    return sp
  }
  run(context) {
    this.count = this.steps = this.sp = 0
    try {
      this.execute(context)
    } catch (error) {
      this.count = 0 // transactional: never publish a partially evaluated face
      throw error
    }
    return this.count
  }
  execute(context) {
    if (!(context instanceof Float32Array) || context.length !== 41) fail('context size')
    for (let i = 0; i < context.length; i++) finite(context[i])
    const p = this.program,
      code = p.opcodes,
      operands = p.operands,
      fns = p.functions,
      stack = this.stack,
      locals = this.locals,
      frames = this.frames,
      budget = this.instructionBudget
    const scale = context[2],
      cx = Math.fround(context[0] / 2),
      cy = Math.fround(context[1] / 2)
    if (context[0] < 1 || context[1] < 1 || scale <= 0) fail('canvas range')
    let pc = fns[p.entry * 3],
      depth = 1,
      base = 0,
      localSize = fns[p.entry * 3 + 2],
      groups = 0,
      sp = 0,
      steps = 0
    locals.fill(0, 0, localSize)
    frames[0] = 0
    frames[1] = base
    frames[2] = localSize
    for (;;) {
      this.steps = ++steps
      if (steps > budget) fail('instruction budget')
      if (pc >= code.length) fail('program counter')
      const op = code[pc],
        operand = operands[pc++]
      let a, b, v
      let push = true
      switch (op) {
        case Nop:
          push = false
          break
        case PushF32:
        case PushI8:
        case PushI16:
        case PushConst:
          v = operand
          break
        case PushVar:
          v = context[operand]
          break
        case PushLocal:
          if (operand >= localSize) fail('local reference')
          v = locals[base + operand]
          break
        case StoreLocal:
          if (operand >= localSize) fail('local reference')
          if (!sp) fail('stack underflow')
          locals[base + operand] = stack[--sp]
          push = false
          break
        case Pop:
          if (!sp) fail('stack underflow')
          sp--
          push = false
          break
        case Dup:
          if (!sp) fail('stack underflow')
          v = stack[sp - 1]
          break
        case Add:
        case Sub:
        case Mul:
        case Div:
        case Min:
        case Max:
        case Mod:
        case Eq:
        case Ne:
        case Lt:
        case Le:
        case Gt:
        case Ge:
        case And:
        case Or:
        case Xor:
          if (sp < 2) fail('stack underflow')
          b = stack[--sp]
          a = stack[--sp]
          switch (op) {
            case Add:
              v = a + b
              break
            case Sub:
              v = a - b
              break
            case Mul:
              v = a * b
              break
            case Div:
              if (!b) fail('divide by zero')
              v = a / b
              break
            case Mod:
              if (!b) fail('divide by zero')
              v = a % b
              break
            case Min:
              v = Math.min(a, b)
              break
            case Max:
              v = Math.max(a, b)
              break
            case Eq:
              v = a === b ? 1 : 0
              break
            case Ne:
              v = a !== b ? 1 : 0
              break
            case Lt:
              v = a < b ? 1 : 0
              break
            case Le:
              v = a <= b ? 1 : 0
              break
            case Gt:
              v = a > b ? 1 : 0
              break
            case Ge:
              v = a >= b ? 1 : 0
              break
            case And:
              v = a !== 0 && b !== 0 ? 1 : 0
              break
            case Or:
              v = a !== 0 || b !== 0 ? 1 : 0
              break
            case Xor:
              v = (a !== 0) !== (b !== 0) ? 1 : 0
              break
          }
          break
        case Neg:
        case Abs:
        case Floor:
        case Round:
        case Sqrt:
        case Not:
        case Scale:
        case Tx:
        case Ty:
          if (!sp) fail('stack underflow')
          a = stack[--sp]
          switch (op) {
            case Neg:
              v = -a
              break
            case Abs:
              v = Math.abs(a)
              break
            case Floor:
              v = Math.floor(a)
              break
            case Round:
              v = a < 0 ? -Math.floor(-a + 0.5) : Math.floor(a + 0.5)
              break
            case Sqrt:
              v = Math.sqrt(a)
              break
            case Not:
              v = a === 0 ? 1 : 0
              break
            case Scale:
              v = Math.max(1, Math.fround(a * scale))
              break
            case Tx:
              v = cx + Math.fround(Math.fround(a - 160) * scale)
              break
            case Ty:
              v = cy + Math.fround(Math.fround(a - 120) * scale)
              break
          }
          break
        case Clamp:
          if (sp < 3) fail('stack underflow')
          b = stack[--sp]
          a = stack[--sp]
          v = stack[--sp]
          v = v < a ? a : v > b ? b : v
          break
        case Jmp:
        case Jz:
        case Jnz:
          if (op !== Jmp && !sp) fail('stack underflow')
          if (op === Jmp || (op === Jz ? stack[--sp] === 0 : stack[--sp] !== 0)) pc = operand
          push = false
          break
        case Call: {
          const id = operand,
            params = fns[id + 1],
            size = fns[id + 2],
            nextBase = base + localSize
          if (depth >= 16) fail('call depth')
          if (nextBase + size > 256) fail('locals overflow')
          if (sp < params) fail('stack underflow')
          for (let i = params - 1; i >= 0; i--) locals[nextBase + i] = stack[--sp]
          locals.fill(0, nextBase + params, nextBase + size)
          const frame = depth++ * 3
          frames[frame] = pc
          frames[frame + 1] = nextBase
          frames[frame + 2] = size
          base = nextBase
          localSize = size
          pc = fns[id]
          push = false
          break
        }
        case Ret:
          if (--depth === 0) {
            if (groups) fail('unclosed group')
            this.sp = sp
            return
          }
          pc = frames[depth * 3]
          base = frames[(depth - 1) * 3 + 1]
          localSize = frames[(depth - 1) * 3 + 2]
          push = false
          break
        case FillRect:
          sp = this.emit(op, 4, true, sp)
          push = false
          break
        case FillCircle:
          sp = this.emit(op, 3, true, sp)
          push = false
          break
        case FillTriangle:
          sp = this.emit(op, 6, true, sp)
          push = false
          break
        case BeginGroup:
          if (++groups > 16) fail('group depth')
          sp = this.emit(op, 4, false, sp)
          push = false
          break
        case EndGroup:
          if (!groups--) fail('group underflow')
          sp = this.emit(op, 0, false, sp)
          push = false
          break
        default:
          fail('opcode')
      }
      // Let the switch finish: XS 9.5.0 leaks its switch value on a
      // continue inside a case. The bounded-loop native test guards this.
      if (push) {
        if (sp >= 64) fail('stack overflow')
        // Float32Array rounds exactly once. Reject overflow/NaN after rounding.
        stack[sp] = v
        finite(stack[sp])
        sp++
      }
    }
  }
}
