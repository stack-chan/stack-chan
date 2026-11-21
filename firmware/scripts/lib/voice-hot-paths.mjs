import { stripTypeScriptTypes } from 'node:module'
import { parse } from 'acorn'

// These are architecture constraints, not a claim that all JS loops are slow.
// TTS providers orchestrate events; bulk PCM work belongs in the bounded codec.
export function checkVoiceHotPaths(source, filename = 'provider.ts') {
  const file = parse(stripTypeScriptTypes(source, { mode: 'strip' }), {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  })
  const failures = []
  const report = (node, message) => {
    failures.push({ file: filename, line: node.loc.start.line, column: node.loc.start.column + 1, message })
  }
  const children = (node, visit) => {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') visit(child)
      } else if (value && typeof value.type === 'string') visit(value)
    }
  }
  function inspect(node, policy) {
    if (
      policy === 'tts' &&
      ['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type)
    )
      report(node, 'TTS providers must delegate bulk iteration to the bounded PCM boundary')
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
      const name = node.callee.property.name
      if (
        policy === 'tts' &&
        ['fromBase64', 'fromHex', 'getInt16', 'getUint16', 'map', 'filter', 'reduce', 'forEach'].includes(name)
      )
        report(node, 'Use the common PCM boundary instead of per-byte/sample processing in a TTS provider')
      if (policy === 'sse' && ['split', 'map', 'filter', 'reduce', 'forEach'].includes(name))
        report(node, 'SSE framing must not materialize array pipelines containing audio payloads')
    }
    if (
      policy === 'tts' &&
      node.type === 'NewExpression' &&
      node.callee.type === 'Identifier' &&
      ['DataView', 'Uint8Array', 'Int16Array', 'Uint16Array'].includes(node.callee.name)
    )
      report(node, 'Allocate PCM storage in the common bounded PCM boundary, not the TTS provider')
    children(node, (child) => inspect(child, policy))
  }
  function discover(node) {
    if (node.type === 'FunctionDeclaration' && node.id && node.body) {
      if (/^create.*TTS$/.test(node.id.name)) inspect(node.body, 'tts')
      else if (node.id.name === 'consumeSSE') inspect(node.body, 'sse')
    }
    children(node, discover)
  }
  discover(file)
  return failures
}
