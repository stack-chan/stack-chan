#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
// SPDX-License-Identifier: BSL-1.0
//
// Node CLI: `node cli.mjs <input.avdsl> <output.avbc>`. Used by
// components/avatar_vm/CMakeLists.txt to compile the default face at build
// time. The browser path imports compile.js directly and never touches Node.

import { readFileSync, writeFileSync } from 'node:fs';
import { compile } from './compile.js';

function fail(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  fail('usage: cli.mjs <input.avdsl> <output.avbc>');
}
const [inPath, outPath] = args;

let source;
try { source = readFileSync(inPath, 'utf8'); }
catch (e) { fail(`cannot read ${inPath}: ${e.message}`); }

let buf;
try { buf = compile(source); }
catch (e) {
  fail(`compile failed (${inPath}): ${e.message}`);
}

try { writeFileSync(outPath, Buffer.from(buf)); }
catch (e) { fail(`cannot write ${outPath}: ${e.message}`); }

process.stdout.write(`[avatar_dsl] ${inPath} -> ${outPath} (${buf.byteLength} bytes)\n`);
