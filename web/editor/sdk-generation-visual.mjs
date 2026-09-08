import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Blockly from 'blockly/core'
import 'blockly/blocks'
import * as en from 'blockly/msg/en'
import { javascriptGenerator, Order } from 'blockly/javascript'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'
import { assembleModSource, registerStackchanBlocks } from './blocks.mjs'
import { applyFaceAssetToSource, createFaceAsset } from './face-assets.mjs'
import { buildModArchive } from './mod-builder.mjs'
import { createVisualProject } from './project-format.mjs'
import { createVisualModDefinition } from './project-mod-definition.mjs'
import createTools from './vendor/tools.js'

Blockly.setLocale(en)
registerStackchanBlocks(Blockly, javascriptGenerator, Order)
const output = resolve('../firmware/dist/blockly-sdk')
mkdirSync(output, { recursive: true })
const text = (value) => ({ shadow: { type: 'text', fields: { TEXT: value } } })
const log = (message, next) => ({
  type: 'stackchan_trace',
  inputs: { TEXT: text(message) },
  ...(next ? { next: { block: next } } : {}),
})
const workspace = {
  blocks: {
    languageVersion: 0,
    blocks: [
      { type: 'stackchan_on_start', inputs: { DO: { block: log('VP_BOOT') } } },
      {
        type: 'stackchan_on_button',
        fields: { BUTTON: 'a', EDGE: 'press' },
        inputs: {
          DO: {
            block: log('VP_BEGIN', {
              type: 'stackchan_tone',
              fields: { NOTE: '440', DURATION: 100 },
              next: {
                block: log('VP_AUDIO_DONE', {
                  type: 'stackchan_wait',
                  fields: { DURATION: 4000 },
                  next: { block: log('VP_LATE_FINISH') },
                }),
              },
            }),
          },
        },
      },
      {
        type: 'stackchan_on_button',
        fields: { BUTTON: 'a', EDGE: 'release' },
        inputs: { DO: { block: log('VP_RELEASE') } },
      },
      { type: 'stackchan_every', fields: { SECONDS: 0.2 }, inputs: { DO: { block: log('VP_TICK') } } },
    ],
  },
}
const testProject = createVisualProject({ name: 'SDK generated lifecycle', target: 'simulator', workspace })
const asset = createFaceAsset({
  name: 'SDK Shape',
  primary: '#30e0ff',
  secondary: '#301020',
  emotion: 'HAPPY',
  shape: {
    eyes: { left: { shape: 'roundRect', width: 30, height: 16, r: 4, x: 45 }, right: { radius: 6, x: 155 } },
    mouth: { visible: false },
  },
})
async function build(project, face) {
  const blocks = new Blockly.Workspace()
  try {
    Blockly.serialization.workspaces.load(project.workspace, blocks)
    let source = assembleModSource(javascriptGenerator.workspaceToCode(blocks))
    if (face) source = applyFaceAssetToSource(source, face)
    const metadata = createVisualModDefinition(project)
    if (face) metadata.capabilities = [...new Set([...metadata.capabilities, 'face', 'ui.controls'])].sort()
    const bytes = await buildModArchive(createTools, { modJs: source, metadata, name: 'sdk-generated' })
    return { bytes, source }
  } finally {
    blocks.dispose()
  }
}
// Published block packages use exactly the same generator and build contract.
for (const name of ['hello', 'buttons', 'look-around', 'sensors']) {
  const folder = `mod-gallery/samples/${name}`
  const declaration = JSON.parse(readFileSync(`${folder}/stackchan-mod.json`, 'utf8'))
  const project = JSON.parse(readFileSync(`${folder}/${declaration.source.path}`, 'utf8'))
  const generated = createVisualModDefinition(project)
  assert.deepEqual(declaration.capabilities, generated.capabilities)
  assert.equal(declaration.appApiVersion, generated.appApiVersion)
  assert.equal(declaration.hostApiVersion, generated.hostApiVersion)
  const { bytes } = await build(project)
  writeFileSync(`${output}/${name}.xsa`, bytes)
}
const generated = await build(testProject, asset)
writeFileSync(`${output}/generated.xsa`, generated.bytes)
writeFileSync(`${output}/mod.js`, generated.source)
const replacement = await build(
  createVisualProject({
    name: 'Replacement',
    target: 'simulator',
    workspace: {
      blocks: { blocks: [{ type: 'stackchan_on_start', inputs: { DO: { block: log('VP_REPLACEMENT') } } }] },
    },
  })
)
const { baseUrl, server } = await startPreview({ port: Number(process.env.STACKCHAN_BLOCKLY_TEST_PORT ?? 8103) })
let browser
const messages = []
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addInitScript(() => {
    localStorage.setItem('stackchan.locale', 'ja')
    window.generatedTones = []
    const start = OscillatorNode.prototype.start
    OscillatorNode.prototype.start = function (...args) {
      window.generatedTones.push(this.frequency.value)
      return start.apply(this, args)
    }
  })
  const page = await context.newPage()
  page.on('console', (message) => messages.push(message.text()))
  page.on('pageerror', (error) => messages.push(`PAGE_ERROR ${error.message}`))
  const wait = (marker) =>
    page.waitForEvent('console', { predicate: (message) => message.text().includes(marker), timeout: 45_000 })
  const install = (bytes, marker) =>
    Promise.all([
      wait(marker),
      page
        .getByLabel('MODを追加', { exact: true })
        .setInputFiles({ name: 'sdk-generated.xsa', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) }),
    ])
  await Promise.all([
    wait('[main] app behaviors ready'),
    page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' }),
  ])
  await install(generated.bytes, 'VP_BOOT')
  await wait('VP_TICK')
  await page.screenshot({ path: `${output}/shape.png` })
  await Promise.all([wait('VP_AUDIO_DONE'), page.getByRole('button', { name: 'A', exact: true }).click()])
  assert.ok(messages.some((message) => message.includes('VP_RELEASE')))
  assert.ok(await page.evaluate(() => window.generatedTones.includes(440)))
  await install(replacement.bytes, 'VP_REPLACEMENT')
  const ticks = messages.filter((message) => message.includes('VP_TICK')).length
  await page.waitForTimeout(4200)
  assert.equal(messages.filter((message) => message.includes('VP_TICK')).length, ticks)
  assert.equal(
    messages.some((message) => message.includes('VP_LATE_FINISH')),
    false
  )
  const errors = messages.filter((message) =>
    /XS abort|PAGE_ERROR|\[main\] error|\[app\] |VP_RUNTIME_HANDLER/.test(message)
  )
  assert.deepEqual(errors, [])
  console.log('ok: 4 Gallery archives, generated shape/input/audio, replacement cancels waits and periodic work')
} catch (error) {
  console.error(messages.slice(-50).join('\n'))
  throw error
} finally {
  await browser?.close()
  server.kill()
}
