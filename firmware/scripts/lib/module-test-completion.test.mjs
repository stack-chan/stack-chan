import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { moduleTestResult } from './xsdb-session.mjs'

const entry = fileURLToPath(
  new URL(
    '../../host/modules/connectivity/mcp-client/__tests__/mcp-client-service/mcp-client-service.test.ts',
    import.meta.url,
  ),
)

test('MCP test completion rejects each asynchronous request failure instead of reporting PASS', () => {
  const root = mkdtempSync(join(tmpdir(), 'stackchan-completion-'))
  const loader = join(root, 'loader.mjs')
  const bootstrap = join(root, 'bootstrap.mjs')
  const sources = {
    'mcp-client': `
const probe = step => { if (process.env.STACKCHAN_FAIL_STEP === step) throw new Error('injected ' + step); };
export class MCPClientService {
  resets = 0;
  constructor() { probe('construct'); }
  async initialize() { probe(this.resets ? 'reinitialize' : 'initialize');return {protocolVersion:'fixture', serverInfo:{name:'fixture',version:'1'}}; }
  async listTools() { probe('listTools');return {tools:[]}; }
  async callTool(name) { probe(this.resets ? 'echo-after-reset' : name);return {content:[{text:'fixture'}]}; }
  reset() { this.resets++; }
}
`,
    'mcp-server': `export class MCPServerService { constructor() {if (process.env.STACKCHAN_FAIL_STEP === 'server') throw new Error('injected server');} }`,
    timer: 'export default {set(callback) { return setTimeout(callback, 1); }};',
  }
  writeFileSync(
    loader,
    `
const sources = ${JSON.stringify(sources)};
export function resolve(specifier, context, next) {
  if (Object.hasOwn(sources, specifier)) return {url:'data:text/javascript,'+encodeURIComponent(sources[specifier]),shortCircuit:true};
  return next(specifier, context);
}
`,
  )
  writeFileSync(
    bootstrap,
    `
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
register(${JSON.stringify(loader)}, import.meta.url);
globalThis.trace = text => process.stdout.write(text);
await import(pathToFileURL(${JSON.stringify(entry)}));
`,
  )
  try {
    for (const step of [
      'none',
      'server',
      'construct',
      'initialize',
      'listTools',
      'echo',
      'add',
      'get_status',
      'reinitialize',
      'echo-after-reset',
    ]) {
      const result = spawnSync(process.execPath, ['--experimental-strip-types', bootstrap], {
        env: { ...process.env, STACKCHAN_FAIL_STEP: step },
        encoding: 'utf8',
        timeout: 5000,
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(moduleTestResult(result.stdout), step === 'none' ? 'pass' : 'fail', `${step}: ${result.stdout}`)
      if (step !== 'none') assert.ok(!result.stdout.includes('@@STACKCHAN_TEST:PASS@@'), `${step}: ${result.stdout}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
