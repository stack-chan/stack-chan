import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { manifestUsesWebRtc, prepareWebRtcSolution, webRtcSolutionFingerprint } from './webrtc-solution.mjs'

const firmware = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('standard host manifests include WebRTC for both CoreS3 boards and leave other boards unchanged', () => {
  for (const platform of ['m5stack_cores3', 'm5stackchan_cores3'])
    assert.equal(manifestUsesWebRtc(path.join(firmware, 'host/app/manifest.json'), platform), true, platform)
  for (const platform of ['m5stack', 'm5stack_core2', 'stackchan_rt', 'takao_core2_sg90', 'wasm'])
    assert.equal(manifestUsesWebRtc(path.join(firmware, 'host/app/manifest.json'), platform), false, platform)
})

test('dependency graph discovery handles board conditions and shared cyclic includes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-webrtc-graph-'))
  try {
    writeFileSync(
      path.join(directory, 'root.json'),
      JSON.stringify({
        include: ['./shared.json'],
        platforms: { 'esp32/m5stack_cores3': { include: ['./capability.json'] } },
      }),
    )
    writeFileSync(path.join(directory, 'shared.json'), JSON.stringify({ include: ['./root.json'] }))
    writeFileSync(
      path.join(directory, 'capability.json'),
      JSON.stringify({ modules: { realtimeConversation: './api' } }),
    )
    assert.equal(manifestUsesWebRtc(path.join(directory, 'root.json'), 'm5stack_cores3'), true)
    assert.equal(manifestUsesWebRtc(path.join(directory, 'root.json'), 'm5stack'), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('dependency discovery accepts directory includes supported by mcconfig', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-webrtc-directory-'))
  try {
    mkdirSync(path.join(directory, 'capability'))
    writeFileSync(
      path.join(directory, 'capability/manifest.json'),
      JSON.stringify({
        modules: { realtimeConversation: './api' },
      }),
    )
    writeFileSync(path.join(directory, 'root.json'), JSON.stringify({ include: ['./capability'] }))
    assert.equal(manifestUsesWebRtc(path.join(directory, 'root.json'), 'm5stack_cores3'), true)
    assert.equal(manifestUsesWebRtc(path.join(directory, 'root.json'), 'm5stackchan_cores3'), true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('local dependency sources are validated without mutation and changes invalidate their fingerprint', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-webrtc-sources-'))
  try {
    // These are the externally supplied libraries needed by the native backend.
    for (const name of ['esp_webrtc', 'esp_peer', 'media_lib_utils', 'webrtc_utils', 'av_render']) {
      const component = path.join(directory, 'components', name)
      mkdirSync(component, { recursive: true })
      writeFileSync(path.join(component, 'CMakeLists.txt'), '# fixture\n')
    }
    const source = path.join(directory, 'components/esp_peer/peer.c')
    writeFileSync(source, 'void peer(void) {}\n')
    const before = readFileSync(source, 'utf8')
    assert.equal(prepareWebRtcSolution({ solutionDirectory: directory }), directory)
    const fingerprint = webRtcSolutionFingerprint(directory)
    assert.equal(webRtcSolutionFingerprint(directory), fingerprint)
    assert.equal(readFileSync(source, 'utf8'), before)
    writeFileSync(source, 'void peer(void) { /* changed implementation */ }\n')
    assert.notEqual(webRtcSolutionFingerprint(directory), fingerprint)
    rmSync(path.join(directory, 'components/esp_peer/CMakeLists.txt'))
    assert.throws(() => prepareWebRtcSolution({ solutionDirectory: directory }), /Missing WebRTC component/)
    assert.equal(readFileSync(source, 'utf8'), 'void peer(void) { /* changed implementation */ }\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
