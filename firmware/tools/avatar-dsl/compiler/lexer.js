// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
//
// Tokeniser for the avatar DSL (Lua-flavoured imperative). The grammar is
// line-position-sensitive only for error reporting; whitespace is otherwise
// insignificant.

const KEYWORDS = new Set([
  'fn', 'end', 'let', 'if', 'then', 'elif', 'else', 'while', 'do', 'return',
  'and', 'or', 'not', 'true', 'false',
]);

// Multi-character symbols, longest first.
const SYMBOLS = [
  '==', '!=', '<=', '>=', '~=',
  '+', '-', '*', '/', '%',
  '<', '>', '=',
  '(', ')', ',',
];

export class LexError extends Error {
  constructor(msg, line, col) {
    super(`line ${line}:${col}: ${msg}`);
    this.line = line;
    this.col = col;
  }
}

export function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const advance = (n = 1) => {
    for (let k = 0; k < n; ++k) {
      if (source[i] === '\n') { ++line; col = 1; } else { ++col; }
      ++i;
    }
  };
  const peek = (off = 0) => source[i + off];
  const startsWith = (s) => source.slice(i, i + s.length) === s;
  const isIdentStart = (c) => /[A-Za-z_]/.test(c);
  const isIdentCont = (c) => /[A-Za-z0-9_]/.test(c);

  while (i < source.length) {
    const c = source[i];
    // whitespace
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { advance(); continue; }
    // line comment
    if (c === '-' && peek(1) === '-') {
      while (i < source.length && source[i] !== '\n') advance();
      continue;
    }
    const startLine = line;
    const startCol = col;
    // identifier / keyword
    if (isIdentStart(c)) {
      let s = '';
      while (i < source.length && isIdentCont(source[i])) { s += source[i]; advance(); }
      if (KEYWORDS.has(s)) {
        tokens.push({ kind: s, value: s, line: startLine, col: startCol });
      } else {
        tokens.push({ kind: 'ident', value: s, line: startLine, col: startCol });
      }
      continue;
    }
    // number (int / float / hex)
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(peek(1)))) {
      let s = '';
      if (c === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
        s = '0x'; advance(2);
        while (i < source.length && /[0-9a-fA-F]/.test(source[i])) { s += source[i]; advance(); }
        tokens.push({ kind: 'number', value: parseInt(s, 16), line: startLine, col: startCol });
        continue;
      }
      while (i < source.length && /[0-9]/.test(source[i])) { s += source[i]; advance(); }
      if (source[i] === '.') {
        s += '.'; advance();
        while (i < source.length && /[0-9]/.test(source[i])) { s += source[i]; advance(); }
      }
      if (source[i] === 'e' || source[i] === 'E') {
        s += source[i]; advance();
        if (source[i] === '+' || source[i] === '-') { s += source[i]; advance(); }
        while (i < source.length && /[0-9]/.test(source[i])) { s += source[i]; advance(); }
      }
      tokens.push({ kind: 'number', value: parseFloat(s), line: startLine, col: startCol });
      continue;
    }
    // symbols
    let matched = null;
    for (const sym of SYMBOLS) {
      if (startsWith(sym)) { matched = sym; break; }
    }
    if (matched) {
      tokens.push({ kind: matched, value: matched, line: startLine, col: startCol });
      advance(matched.length);
      continue;
    }
    throw new LexError(`unexpected character '${c}'`, line, col);
  }
  tokens.push({ kind: 'eof', value: null, line, col });
  return tokens;
}
