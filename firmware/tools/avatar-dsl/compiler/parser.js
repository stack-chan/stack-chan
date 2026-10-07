// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
//
// Recursive-descent parser producing a per-function AST. The top-level program
// is a list of `fn` declarations; nothing else lives at top level. The
// expression grammar follows the standard precedence climb (lowest to
// highest):
//   or > and > == != > < <= > >= > ~= (xor) > + - > * / % > unary - not > call/atom

export class ParseError extends Error {
  constructor(msg, tok) {
    super(`line ${tok?.line}:${tok?.col}: ${msg}`);
    this.tok = tok;
  }
}

class Parser {
  constructor(tokens) {
    this.toks = tokens;
    this.i = 0;
  }
  peek(off = 0) { return this.toks[this.i + off]; }
  eat() { return this.toks[this.i++]; }
  expect(kind, msg) {
    const t = this.peek();
    if (t.kind !== kind) throw new ParseError(msg || `expected '${kind}' but got '${t.kind}'`, t);
    return this.eat();
  }
  matches(...kinds) {
    const t = this.peek();
    return kinds.includes(t.kind);
  }

  parseProgram() {
    const fns = [];
    while (this.peek().kind !== 'eof') {
      if (this.peek().kind !== 'fn') {
        throw new ParseError(`expected 'fn' at top level, got '${this.peek().kind}'`, this.peek());
      }
      fns.push(this.parseFn());
    }
    return { type: 'Program', fns };
  }

  parseFn() {
    const kwTok = this.expect('fn');
    const nameTok = this.expect('ident', 'expected function name after `fn`');
    this.expect('(');
    const params = [];
    if (this.peek().kind !== ')') {
      params.push(this.expect('ident').value);
      while (this.peek().kind === ',') { this.eat(); params.push(this.expect('ident').value); }
    }
    this.expect(')');
    const body = this.parseBlock(['end']);
    this.expect('end');
    return { type: 'Fn', name: nameTok.value, params, body, line: kwTok.line, col: kwTok.col };
  }

  // Parse statements until any of `enders` would be the next token.
  parseBlock(enders) {
    const stmts = [];
    while (!enders.includes(this.peek().kind) && this.peek().kind !== 'eof') {
      stmts.push(this.parseStmt());
    }
    return stmts;
  }

  parseStmt() {
    const t = this.peek();
    if (t.kind === 'let') return this.parseLet();
    if (t.kind === 'if') return this.parseIf();
    if (t.kind === 'while') return this.parseWhile();
    if (t.kind === 'return') { this.eat(); return { type: 'Return', line: t.line, col: t.col }; }
    // Assignment OR call statement. Both start with `ident`.
    if (t.kind === 'ident') {
      // Lookahead for `=`: `ident =`
      if (this.peek(1)?.kind === '=') {
        const name = this.eat().value;
        this.eat(); // =
        const value = this.parseExpr();
        return { type: 'Assign', name, value, line: t.line, col: t.col };
      }
      // Otherwise expression statement (typically a call). The expression's
      // result is discarded (Pop emitted for non-void calls).
      const expr = this.parseExpr();
      return { type: 'ExprStmt', expr, line: t.line, col: t.col };
    }
    throw new ParseError(`unexpected '${t.kind}' at start of statement`, t);
  }

  parseLet() {
    const t = this.expect('let');
    const name = this.expect('ident').value;
    this.expect('=');
    const value = this.parseExpr();
    return { type: 'Let', name, value, line: t.line, col: t.col };
  }

  parseIf() {
    const t = this.expect('if');
    const cond = this.parseExpr();
    this.expect('then');
    const thenBody = this.parseBlock(['elif', 'else', 'end']);
    const elifs = [];
    while (this.peek().kind === 'elif') {
      this.eat();
      const ec = this.parseExpr();
      this.expect('then');
      const eb = this.parseBlock(['elif', 'else', 'end']);
      elifs.push({ cond: ec, body: eb });
    }
    let elseBody = null;
    if (this.peek().kind === 'else') {
      this.eat();
      elseBody = this.parseBlock(['end']);
    }
    this.expect('end');
    return { type: 'If', cond, thenBody, elifs, elseBody, line: t.line, col: t.col };
  }

  parseWhile() {
    const t = this.expect('while');
    const cond = this.parseExpr();
    this.expect('do');
    const body = this.parseBlock(['end']);
    this.expect('end');
    return { type: 'While', cond, body, line: t.line, col: t.col };
  }

  // ---- expression precedence ----
  parseExpr() { return this.parseOr(); }
  parseOr() {
    let l = this.parseAnd();
    while (this.peek().kind === 'or') {
      const t = this.eat();
      const r = this.parseAnd();
      l = { type: 'Bin', op: 'or', l, r, line: t.line, col: t.col };
    }
    return l;
  }
  parseAnd() {
    let l = this.parseEq();
    while (this.peek().kind === 'and') {
      const t = this.eat();
      const r = this.parseEq();
      l = { type: 'Bin', op: 'and', l, r, line: t.line, col: t.col };
    }
    return l;
  }
  parseEq() {
    let l = this.parseRel();
    while (this.matches('==', '!=', '~=')) {
      const t = this.eat();
      const r = this.parseRel();
      l = { type: 'Bin', op: t.kind, l, r, line: t.line, col: t.col };
    }
    return l;
  }
  parseRel() {
    let l = this.parseAdd();
    while (this.matches('<', '<=', '>', '>=')) {
      const t = this.eat();
      const r = this.parseAdd();
      l = { type: 'Bin', op: t.kind, l, r, line: t.line, col: t.col };
    }
    return l;
  }
  parseAdd() {
    let l = this.parseMul();
    while (this.matches('+', '-')) {
      const t = this.eat();
      const r = this.parseMul();
      l = { type: 'Bin', op: t.kind, l, r, line: t.line, col: t.col };
    }
    return l;
  }
  parseMul() {
    let l = this.parseUnary();
    while (this.matches('*', '/', '%')) {
      const t = this.eat();
      const r = this.parseUnary();
      l = { type: 'Bin', op: t.kind, l, r, line: t.line, col: t.col };
    }
    return l;
  }
  parseUnary() {
    const t = this.peek();
    if (t.kind === '-') { this.eat(); return { type: 'Un', op: '-', e: this.parseUnary(), line: t.line, col: t.col }; }
    if (t.kind === 'not') { this.eat(); return { type: 'Un', op: 'not', e: this.parseUnary(), line: t.line, col: t.col }; }
    return this.parsePostfix();
  }
  parsePostfix() {
    let e = this.parseAtom();
    // Function call: ident ( args )
    while (this.peek().kind === '(') {
      const lp = this.eat();
      const args = [];
      if (this.peek().kind !== ')') {
        args.push(this.parseExpr());
        while (this.peek().kind === ',') { this.eat(); args.push(this.parseExpr()); }
      }
      this.expect(')');
      if (e.type !== 'Ident') {
        throw new ParseError('call target must be an identifier', lp);
      }
      e = { type: 'Call', name: e.name, args, line: e.line, col: e.col };
    }
    return e;
  }
  parseAtom() {
    const t = this.peek();
    if (t.kind === 'number') { this.eat(); return { type: 'Num', value: t.value, line: t.line, col: t.col }; }
    if (t.kind === 'true' || t.kind === 'false') {
      this.eat();
      return { type: 'Num', value: t.kind === 'true' ? 1 : 0, line: t.line, col: t.col };
    }
    if (t.kind === 'ident') { this.eat(); return { type: 'Ident', name: t.value, line: t.line, col: t.col }; }
    if (t.kind === '(') {
      this.eat();
      const e = this.parseExpr();
      this.expect(')');
      return e;
    }
    throw new ParseError(`unexpected '${t.kind}' in expression`, t);
  }
}

export function parse(tokens) {
  return new Parser(tokens).parseProgram();
}
