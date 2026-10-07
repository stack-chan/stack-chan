// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
// JavaScript adaptation of avatar_vm/decoder.cpp and vm.cpp at the pinned commit.
// See vendor/PROVENANCE.json. Stricter rejection/budgets are intentional.
import { Op, Var } from 'avatar-dsl/vendor/compiler/opcodes'

const arity = new Uint8Array(0x47)
arity[Op.PushF32] = 4
for (const op of [Op.PushI8, Op.PushConst, Op.PushVar, Op.PushLocal, Op.StoreLocal, Op.Call]) arity[op] = 1
for (const op of [Op.PushI16, Op.Jmp, Op.Jz, Op.Jnz]) arity[op] = 2
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
    if (op === Op.PushF32) finite(cv.getFloat32(pc, true))
    if (op === Op.PushConst && code[pc] >= nc) fail('constant reference')
    if (op === Op.PushVar && code[pc] >= Object.keys(Var).length) fail('context reference')
    if (op === Op.Call && code[pc] >= nf) fail('function reference')
    pc += n
  }
  for (let i = 0; i < nf; i++) if (!boundaries[functions[i * 3]]) fail('function boundary')
  // Functions may share code. Validate local references by the executing frame
  // at runtime rather than guessing function ends from declaration order.
  for (let pc = 0; pc < codeSize; ) {
    const op = code[pc++],
      n = arity[op]
    if (op === Op.Jmp || op === Op.Jz || op === Op.Jnz) {
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
      if ((op === Op.PushLocal || op === Op.StoreLocal) && code[start + 1] >= functions[i * 3 + 2])
        fail('local reference')
      if (op === Op.Ret) continue
      if (op === Op.Jmp || op === Op.Jz || op === Op.Jnz) queue(after + cv.getInt16(start + 1, true))
      if (op !== Op.Jmp) queue(after)
    }
  }
  return { code, view: cv, functions, constants, entry, boundaries }
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
  push(value) {
    if (this.sp >= 64) fail('stack overflow')
    value = Math.fround(value)
    finite(value)
    this.stack[this.sp++] = value
  }
  pop() {
    if (!this.sp) fail('stack underflow')
    return this.stack[--this.sp]
  }
  emit(op, n, color) {
    if (this.count >= this.drawBudget) fail('draw budget')
    const base = this.count * COMMAND_STRIDE
    this.commands.fill(0, base, base + COMMAND_STRIDE)
    this.commands[base] = op
    if (color) {
      const c = Math.trunc(this.pop())
      if (c < 0 || c > 65535) fail('color range')
      this.commands[base + 7] = c
    }
    for (let i = n; i >= 1; i--) {
      const v = Math.trunc(this.pop())
      if (v < -32768 || v > 32767) fail('coordinate range')
      this.commands[base + i] = v
    }
    if (
      (op === Op.FillCircle && this.commands[base + 3] < 0) ||
      ((op === Op.FillRect || op === Op.BeginGroup) && (this.commands[base + 3] < 0 || this.commands[base + 4] < 0))
    )
      fail('negative extent')
    this.count++
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
      code = p.code,
      view = p.view,
      fns = p.functions
    const scale = context[2],
      cx = Math.fround(context[0] / 2),
      cy = Math.fround(context[1] / 2)
    if (context[0] < 1 || context[1] < 1 || scale <= 0) fail('canvas range')
    let pc = fns[p.entry * 3],
      depth = 1,
      base = 0,
      localSize = fns[p.entry * 3 + 2],
      groups = 0
    this.locals.fill(0, 0, localSize)
    this.frames[0] = 0
    this.frames[1] = base
    this.frames[2] = localSize
    for (;;) {
      if (++this.steps > this.instructionBudget) fail('instruction budget')
      if (pc >= code.length || !p.boundaries[pc]) fail('program counter')
      const op = code[pc++]
      let a, b, v
      switch (op) {
        case Op.Nop:
          break
        case Op.PushF32:
          this.push(view.getFloat32(pc, true))
          pc += 4
          break
        case Op.PushI8:
          this.push(view.getInt8(pc++))
          break
        case Op.PushI16:
          this.push(view.getInt16(pc, true))
          pc += 2
          break
        case Op.PushConst:
          this.push(p.constants[code[pc++]])
          break
        case Op.PushVar:
          this.push(context[code[pc++]])
          break
        case Op.PushLocal:
        case Op.StoreLocal: {
          const slot = code[pc++]
          if (slot >= localSize) fail('local reference')
          if (op === Op.PushLocal) this.push(this.locals[base + slot])
          else this.locals[base + slot] = this.pop()
          break
        }
        case Op.Pop:
          this.pop()
          break
        case Op.Dup:
          if (!this.sp) fail('stack underflow')
          this.push(this.stack[this.sp - 1])
          break
        case Op.Add:
        case Op.Sub:
        case Op.Mul:
        case Op.Div:
        case Op.Min:
        case Op.Max:
        case Op.Mod:
        case Op.Eq:
        case Op.Ne:
        case Op.Lt:
        case Op.Le:
        case Op.Gt:
        case Op.Ge:
        case Op.And:
        case Op.Or:
        case Op.Xor:
          b = this.pop()
          a = this.pop()
          switch (op) {
            case Op.Add:
              v = a + b
              break
            case Op.Sub:
              v = a - b
              break
            case Op.Mul:
              v = a * b
              break
            case Op.Div:
              if (!b) fail('divide by zero')
              v = a / b
              break
            case Op.Mod:
              if (!b) fail('divide by zero')
              v = a % b
              break
            case Op.Min:
              v = Math.min(a, b)
              break
            case Op.Max:
              v = Math.max(a, b)
              break
            case Op.Eq:
              v = a === b ? 1 : 0
              break
            case Op.Ne:
              v = a !== b ? 1 : 0
              break
            case Op.Lt:
              v = a < b ? 1 : 0
              break
            case Op.Le:
              v = a <= b ? 1 : 0
              break
            case Op.Gt:
              v = a > b ? 1 : 0
              break
            case Op.Ge:
              v = a >= b ? 1 : 0
              break
            case Op.And:
              v = a !== 0 && b !== 0 ? 1 : 0
              break
            case Op.Or:
              v = a !== 0 || b !== 0 ? 1 : 0
              break
            case Op.Xor:
              v = (a !== 0) !== (b !== 0) ? 1 : 0
              break
          }
          this.push(v)
          break
        case Op.Neg:
        case Op.Abs:
        case Op.Floor:
        case Op.Round:
        case Op.Sqrt:
        case Op.Not:
        case Op.Scale:
        case Op.Tx:
        case Op.Ty:
          a = this.pop()
          switch (op) {
            case Op.Neg:
              v = -a
              break
            case Op.Abs:
              v = Math.abs(a)
              break
            case Op.Floor:
              v = Math.floor(a)
              break
            case Op.Round:
              v = a < 0 ? -Math.floor(-a + 0.5) : Math.floor(a + 0.5)
              break
            case Op.Sqrt:
              v = Math.sqrt(a)
              break
            case Op.Not:
              v = a === 0 ? 1 : 0
              break
            case Op.Scale:
              v = Math.max(1, Math.fround(a * scale))
              break
            case Op.Tx:
              v = cx + Math.fround(Math.fround(a - 160) * scale)
              break
            case Op.Ty:
              v = cy + Math.fround(Math.fround(a - 120) * scale)
              break
          }
          this.push(v)
          break
        case Op.Clamp:
          b = this.pop()
          a = this.pop()
          v = this.pop()
          this.push(v < a ? a : v > b ? b : v)
          break
        case Op.Jmp:
        case Op.Jz:
        case Op.Jnz:
          a = view.getInt16(pc, true)
          pc += 2
          if (op === Op.Jmp || (op === Op.Jz ? this.pop() === 0 : this.pop() !== 0)) pc += a
          break
        case Op.Call: {
          const id = code[pc++] * 3,
            params = fns[id + 1],
            size = fns[id + 2],
            nextBase = base + localSize
          if (depth >= 16) fail('call depth')
          if (nextBase + size > 256) fail('locals overflow')
          if (this.sp < params) fail('stack underflow')
          for (let i = params - 1; i >= 0; i--) this.locals[nextBase + i] = this.pop()
          this.locals.fill(0, nextBase + params, nextBase + size)
          const frame = depth++ * 3
          this.frames[frame] = pc
          this.frames[frame + 1] = nextBase
          this.frames[frame + 2] = size
          base = nextBase
          localSize = size
          pc = fns[id]
          break
        }
        case Op.Ret:
          if (--depth === 0) {
            if (groups) fail('unclosed group')
            return
          }
          pc = this.frames[depth * 3]
          base = this.frames[(depth - 1) * 3 + 1]
          localSize = this.frames[(depth - 1) * 3 + 2]
          break
        case Op.FillRect:
          this.emit(op, 4, true)
          break
        case Op.FillCircle:
          this.emit(op, 3, true)
          break
        case Op.FillTriangle:
          this.emit(op, 6, true)
          break
        case Op.BeginGroup:
          if (++groups > 16) fail('group depth')
          this.emit(op, 4, false)
          break
        case Op.EndGroup:
          if (!groups--) fail('group underflow')
          this.emit(op, 0, false)
          break
        default:
          fail('opcode')
      }
    }
  }
}
