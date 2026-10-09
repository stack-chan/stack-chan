// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
//
// AST -> bytecode emitter. Two passes:
//   1. Collect every `fn` and assign function IDs (`draw` becomes id 0 = entry).
//   2. Per function, walk the AST and emit opcodes. Jump offsets are
//      back-patched after the target instruction's offset is known.
//
// All values on the operand stack are f32. Locals (including parameters) are
// addressed by 0..255 per-function slot. Free numeric constants accumulate in
// a deduplicated const table.

import { Op, Var, ConstTag, SymbolicConsts, Builtins } from './opcodes.js';

export class EmitError extends Error {
  constructor(msg, node) {
    const where = node ? ` (line ${node.line}:${node.col})` : '';
    super(`${msg}${where}`);
  }
}

class CodeBuf {
  constructor() {
    // Storage doubles as needed; we don't pre-size because programs are tiny.
    this.bytes = [];
  }
  get pos() { return this.bytes.length; }
  emit(...bs) { for (const b of bs) this.bytes.push(b & 0xFF); }
  emitU8(v) { this.bytes.push(v & 0xFF); }
  emitI8(v) { this.bytes.push(v & 0xFF); }
  emitU16(v) { this.bytes.push(v & 0xFF, (v >>> 8) & 0xFF); }
  emitI16(v) { this.bytes.push(v & 0xFF, (v >>> 8) & 0xFF); }
  emitF32(v) {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, v, /*le*/ true);
    const u8 = new Uint8Array(buf);
    for (const b of u8) this.bytes.push(b);
  }
  // Write a 2-byte signed value at an existing position.
  patchI16(at, v) {
    this.bytes[at] = v & 0xFF;
    this.bytes[at + 1] = (v >>> 8) & 0xFF;
  }
}

class ConstPool {
  constructor() {
    // Map JS Number -> table index. The bytecode tag is decided at flush time.
    this.entries = []; // [{ value, tag }]
    this.index = new Map(); // key -> i
  }
  add(value, tag) {
    const key = `${tag}:${value}`;
    if (this.index.has(key)) return this.index.get(key);
    const i = this.entries.length;
    if (i > 255) throw new EmitError(`too many constants (>256), got ${i}`);
    this.entries.push({ value, tag });
    this.index.set(key, i);
    return i;
  }
}

class FnCompiler {
  constructor(fn, fnIds, constPool, builtinNames) {
    this.fn = fn;
    this.fnIds = fnIds; // name -> fn_id
    this.consts = constPool;
    this.builtinNames = builtinNames;
    this.code = new CodeBuf();
    // Local slot table. Params occupy slots 0..param_count-1; later `let`s
    // append. Reassignment to an existing name reuses the same slot. Shadowing
    // is intentional but rare (the parser does not enforce scope).
    this.locals = new Map();
    for (let i = 0; i < fn.params.length; ++i) this.locals.set(fn.params[i], i);
    this.localCount = fn.params.length;
  }
  ensureLocal(name) {
    if (this.locals.has(name)) return this.locals.get(name);
    if (this.localCount > 255) throw new EmitError(`too many locals in ${this.fn.name} (>256)`);
    const slot = this.localCount++;
    this.locals.set(name, slot);
    return slot;
  }
  emitBlock(stmts) { for (const s of stmts) this.emitStmt(s); }

  emitStmt(s) {
    switch (s.type) {
      case 'Let': {
        this.emitExpr(s.value);
        const slot = this.ensureLocal(s.name);
        this.code.emit(Op.StoreLocal, slot);
        return;
      }
      case 'Assign': {
        if (!this.locals.has(s.name)) {
          throw new EmitError(`assignment to undeclared variable '${s.name}'`, s);
        }
        this.emitExpr(s.value);
        this.code.emit(Op.StoreLocal, this.locals.get(s.name));
        return;
      }
      case 'ExprStmt': {
        const isVoid = s.expr.type === 'Call' && this.callReturnsVoid(s.expr.name);
        this.emitExpr(s.expr);
        if (!isVoid) this.code.emit(Op.Pop);
        return;
      }
      case 'Return':
        this.code.emit(Op.Ret);
        return;
      case 'If':
        return this.emitIf(s);
      case 'While':
        return this.emitWhile(s);
      default:
        throw new EmitError(`unknown stmt ${s.type}`, s);
    }
  }

  callReturnsVoid(name) {
    const b = Builtins[name];
    if (b) return !b.returns;
    if (this.fnIds.has(name)) return true; // user-defined fns don't return values
    return false;
  }

  emitIf(s) {
    // Generate JZ/JMP chain. For each (cond, body) we emit:
    //   <cond>; JZ next; <body>; JMP end
    // and back-patch JZ -> next, JMP -> end at end.
    const endJumps = [];
    const branches = [{ cond: s.cond, body: s.thenBody }, ...s.elifs];
    for (let bi = 0; bi < branches.length; ++bi) {
      const { cond, body } = branches[bi];
      this.emitExpr(cond);
      this.code.emit(Op.Jz, 0, 0);
      const jzOperand = this.code.pos - 2;
      this.emitBlock(body);
      // Skip to end (unless this is the last branch and there's no else / next).
      const needSkip = (bi < branches.length - 1) || s.elseBody;
      let jmpOperand = -1;
      if (needSkip) {
        this.code.emit(Op.Jmp, 0, 0);
        jmpOperand = this.code.pos - 2;
        endJumps.push(jmpOperand);
      }
      // JZ lands here (next branch or else).
      this.code.patchI16(jzOperand, this.code.pos - (jzOperand + 2));
      // If we emitted a JMP, leave it for the end-of-if patch below.
    }
    if (s.elseBody) this.emitBlock(s.elseBody);
    const endPos = this.code.pos;
    for (const at of endJumps) {
      this.code.patchI16(at, endPos - (at + 2));
    }
  }

  emitWhile(s) {
    const top = this.code.pos;
    this.emitExpr(s.cond);
    this.code.emit(Op.Jz, 0, 0);
    const jzAt = this.code.pos - 2;
    this.emitBlock(s.body);
    this.code.emit(Op.Jmp, 0, 0);
    const jmpAt = this.code.pos - 2;
    this.code.patchI16(jmpAt, top - (jmpAt + 2));
    this.code.patchI16(jzAt, this.code.pos - (jzAt + 2));
  }

  emitExpr(e) {
    switch (e.type) {
      case 'Num':
        return this.emitNumber(e.value);
      case 'Ident':
        return this.emitIdent(e);
      case 'Bin':
        return this.emitBin(e);
      case 'Un':
        return this.emitUn(e);
      case 'Call':
        return this.emitCall(e);
      default:
        throw new EmitError(`unknown expr ${e.type}`, e);
    }
  }

  // Pick the shortest encoding for a numeric literal.
  emitNumber(v) {
    const isInt = Number.isInteger(v);
    if (isInt && v >= -128 && v <= 127) {
      this.code.emit(Op.PushI8, v & 0xFF);
      return;
    }
    if (isInt && v >= -32768 && v <= 32767) {
      this.code.emit(Op.PushI16);
      this.code.emitI16(v);
      return;
    }
    // Anything else (large int, fractional) goes through the const pool — it
    // saves bytes when the same constant is used >1 times and keeps the code
    // section compact.
    const idx = this.consts.add(v, ConstTag.F32);
    this.code.emit(Op.PushConst, idx);
  }

  emitIdent(e) {
    if (Object.prototype.hasOwnProperty.call(SymbolicConsts, e.name)) {
      return this.emitNumber(SymbolicConsts[e.name]);
    }
    if (this.locals.has(e.name)) {
      this.code.emit(Op.PushLocal, this.locals.get(e.name));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(Var, e.name)) {
      this.code.emit(Op.PushVar, Var[e.name]);
      return;
    }
    throw new EmitError(`unknown identifier '${e.name}'`, e);
  }

  emitBin(e) {
    if (e.op === 'and' || e.op === 'or') return this.emitShortCircuit(e);
    this.emitExpr(e.l);
    this.emitExpr(e.r);
    switch (e.op) {
      case '+': this.code.emit(Op.Add); return;
      case '-': this.code.emit(Op.Sub); return;
      case '*': this.code.emit(Op.Mul); return;
      case '/': this.code.emit(Op.Div); return;
      case '%': this.code.emit(Op.Mod); return;
      case '==': this.code.emit(Op.Eq); return;
      case '!=': this.code.emit(Op.Ne); return;
      case '~=': this.code.emit(Op.Xor); return;
      case '<': this.code.emit(Op.Lt); return;
      case '<=': this.code.emit(Op.Le); return;
      case '>': this.code.emit(Op.Gt); return;
      case '>=': this.code.emit(Op.Ge); return;
      default: throw new EmitError(`bad binop ${e.op}`, e);
    }
  }

  // Short-circuit: evaluate L; on false (`and`) / true (`or`) keep L and skip
  // R. We emit: L; DUP; J? skip; POP; R; skip:
  emitShortCircuit(e) {
    this.emitExpr(e.l);
    this.code.emit(Op.Dup);
    if (e.op === 'and') {
      this.code.emit(Op.Jz, 0, 0); // skip R if L is false
    } else {
      this.code.emit(Op.Jnz, 0, 0); // skip R if L is true
    }
    const skipAt = this.code.pos - 2;
    this.code.emit(Op.Pop); // discard duplicated L; R becomes the result
    this.emitExpr(e.r);
    this.code.patchI16(skipAt, this.code.pos - (skipAt + 2));
  }

  emitUn(e) {
    this.emitExpr(e.e);
    if (e.op === '-') { this.code.emit(Op.Neg); return; }
    if (e.op === 'not') { this.code.emit(Op.Not); return; }
    throw new EmitError(`bad unop ${e.op}`, e);
  }

  emitCall(e) {
    const b = Builtins[e.name];
    if (b) {
      if (e.args.length !== b.arity) {
        throw new EmitError(`builtin '${e.name}' expects ${b.arity} args, got ${e.args.length}`, e);
      }
      for (const a of e.args) this.emitExpr(a);
      this.code.emit(b.op);
      return;
    }
    if (this.fnIds.has(e.name)) {
      // User function — push args left-to-right, then CALL.
      for (const a of e.args) this.emitExpr(a);
      this.code.emit(Op.Call, this.fnIds.get(e.name));
      return;
    }
    throw new EmitError(`call to unknown function '${e.name}'`, e);
  }
}

export function emit(ast) {
  // Pass 1: assign function IDs. `draw` is the entry (id 0).
  const fnIds = new Map();
  const drawFn = ast.fns.find((f) => f.name === 'draw');
  if (!drawFn) throw new EmitError("program must define a top-level 'fn draw()'");
  if (drawFn.params.length !== 0) {
    throw new EmitError("'fn draw' must take no parameters", drawFn);
  }
  fnIds.set('draw', 0);
  for (const f of ast.fns) {
    if (f.name === 'draw') continue;
    if (fnIds.has(f.name)) throw new EmitError(`duplicate function '${f.name}'`, f);
    if (fnIds.size > 255) throw new EmitError('too many functions (>256)');
    fnIds.set(f.name, fnIds.size);
  }

  // Pass 2: compile bodies and lay them out back to back. Each function ends
  // with an implicit RET to make a missing trailing return safe.
  const consts = new ConstPool();
  // fnId -> { offset, code: Uint8Array, paramCount, localCount }
  const compiled = new Array(fnIds.size);
  for (const fn of ast.fns) {
    const id = fnIds.get(fn.name);
    const fc = new FnCompiler(fn, fnIds, consts, null);
    fc.emitBlock(fn.body);
    // Ensure trailing RET (idempotent if user wrote it).
    if (fc.code.bytes[fc.code.bytes.length - 1] !== Op.Ret) {
      fc.code.emit(Op.Ret);
    }
    compiled[id] = {
      paramCount: fn.params.length,
      localCount: fc.localCount,
      bytes: fc.code.bytes,
    };
  }

  // Lay out the code section and record per-function offsets.
  const codeBytes = [];
  for (const f of compiled) {
    f.offset = codeBytes.length;
    if (f.offset > 0xFFFF) throw new EmitError('code section exceeds 64KiB');
    for (const b of f.bytes) codeBytes.push(b);
  }
  return {
    consts: consts.entries,
    fns: compiled,
    code: Uint8Array.from(codeBytes),
    entryFnId: 0,
  };
}
