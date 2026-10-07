// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
//
// Top-level entry: source text -> ArrayBuffer of avatar DSL bytecode.
// Header layout matches components/avatar_vm/include/avatar_vm/opcodes.hpp
// and decoder.cpp.

import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { emit } from './emitter.js';
import { MAGIC, VERSION, ConstTag } from './opcodes.js';

export function compile(source) {
  const tokens = tokenize(source);
  const ast = parse(tokens);
  const module_ = emit(ast);
  return packBytecode(module_);
}

function packBytecode(m) {
  // Compute sizes.
  const headerSize = 16;
  let constSize = 0;
  for (const c of m.consts) {
    constSize += 1; // tag
    switch (c.tag) {
      case ConstTag.F32: constSize += 4; break;
      case ConstTag.I32: constSize += 4; break;
      case ConstTag.Color: constSize += 2; break;
      default: throw new Error(`unsupported const tag ${c.tag}`);
    }
  }
  const fnTableSize = m.fns.length * 6;
  const codeSize = m.code.length;
  const total = headerSize + constSize + fnTableSize + codeSize;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Header
  dv.setUint32(0, MAGIC, true);
  dv.setUint16(4, VERSION, true);
  dv.setUint16(6, 0, true); // flags
  dv.setUint16(8, m.consts.length, true);
  dv.setUint16(10, m.fns.length, true);
  dv.setUint16(12, codeSize, true);
  dv.setUint16(14, m.entryFnId, true);

  let off = headerSize;
  // Const table
  for (const c of m.consts) {
    dv.setUint8(off++, c.tag);
    switch (c.tag) {
      case ConstTag.F32: dv.setFloat32(off, c.value, true); off += 4; break;
      case ConstTag.I32: dv.setInt32(off, c.value, true); off += 4; break;
      case ConstTag.Color: dv.setUint16(off, c.value, true); off += 2; break;
    }
  }
  // Fn table
  for (const f of m.fns) {
    dv.setUint16(off, f.offset, true); off += 2;
    dv.setUint8(off++, f.paramCount);
    dv.setUint8(off++, f.localCount);
    dv.setUint16(off, 0, true); off += 2; // reserved
  }
  // Code
  u8.set(m.code, off);
  return buf;
}
