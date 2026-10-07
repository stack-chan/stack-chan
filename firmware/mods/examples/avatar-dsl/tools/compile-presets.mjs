// SPDX-License-Identifier: Apache-2.0
import { readFileSync, writeFileSync } from 'node:fs'
import { compile } from '../vendor/compiler/compile.js'

for (const name of ['default_face', 'omega_mouth', 'aokko_face']) {
  const result = Buffer.from(compile(readFileSync(new URL(`../assets/${name}.avdsl`, import.meta.url), 'utf8')))
  writeFileSync(new URL(`../assets/${name}.avbc`, import.meta.url), result)
  console.log(`${name}: ${result.length} bytes`)
}
