#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { decodeXsbugLog } from './lib/chat-smoke-log.mjs'
import { startXsbugServer } from './lib/xsbug-log-server.js'

const firmwareDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawArguments = process.argv.slice(2)
const readOption = (name) => {
  const index = rawArguments.indexOf(`--${name}`)
  if (index >= 0) {
    const value = rawArguments[index + 1]
    if (!value || value.startsWith('--')) {
      console.error(`--${name} に値を指定してください。`)
      process.exit(1)
    }
    return value
  }
  const prefix = `--${name}=`
  const argument = rawArguments.find((value) => value.startsWith(prefix))
  if (!argument) return undefined
  const value = argument.slice(prefix.length)
  if (!value) {
    console.error(`--${name} に値を指定してください。`)
    process.exit(1)
  }
  return value
}
const replayRequested = rawArguments.some((value) => value === '--from-log' || value.startsWith('--from-log='))
const replayLogPath = readOption('from-log')
const doubleTalkRequested = rawArguments.includes('--double-talk')
const captureManifest = resolve(
  firmwareDirectory,
  doubleTalkRequested
    ? 'host/modules/audio/__tests__/audio-duplex-waveform/manifest.doubletalk.json'
    : 'host/modules/audio/__tests__/audio-duplex-waveform/manifest.json',
)
const safeManifest = resolve(firmwareDirectory, 'host/modules/audio/__tests__/audio-duplex-device/manifest.json')
const captureProfile = JSON.parse(readFileSync(captureManifest, 'utf8')).config?.aecWaveform ?? {}
const uploadPort = process.env.UPLOAD_PORT
const moddableDirectory = process.env.MODDABLE
const serialSpeed = process.env.STACKCHAN_AEC_CAPTURE_BAUD ?? '460800'
const timeoutMs = positiveInteger(
  process.env.STACKCHAN_AEC_CAPTURE_TIMEOUT_MS ?? '120000',
  'STACKCHAN_AEC_CAPTURE_TIMEOUT_MS',
)
const confirmed = rawArguments.includes('--yes')
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const outputDirectory = resolve(
  process.env.STACKCHAN_AEC_CAPTURE_OUTPUT ??
    (replayLogPath ? dirname(resolve(replayLogPath)) : join(firmwareDirectory, 'dist/aec-waveforms', timestamp)),
)

if (replayRequested && !replayLogPath) {
  console.error('--from-log に xsbug-raw.log のパスを指定してください。')
  process.exit(1)
}
if (!replayLogPath && !uploadPort) {
  console.error('UPLOAD_PORT=/dev/ttyACM... を指定してください。')
  process.exit(1)
}
if (!replayLogPath && !moddableDirectory) {
  console.error('MODDABLE が未設定です。xs-dev-export.sh を source してから実行してください。')
  process.exit(1)
}

const serialBridge = moddableDirectory ? resolve(moddableDirectory, 'build/bin/lin/release/serial2xsbug') : undefined
if (!replayLogPath && !existsSync(serialBridge)) {
  console.error(`serial2xsbug が見つかりません: ${serialBridge}`)
  process.exit(1)
}

if (!replayLogPath && !confirmed) {
  if (!stdin.isTTY) {
    console.error('対話確認できません。内容を確認したうえで --yes を指定してください。')
    process.exit(1)
  }
  const prompt = createInterface({ input: stdin, output: stdout })
  const playbackSeconds = ((captureProfile.warmupMs + captureProfile.captureMs) / 1000).toFixed(1)
  const measurementSeconds = (captureProfile.captureSamples / 16000).toFixed(1)
  const doubleTalkInstructions = doubleTalkRequested
    ? [
        `プローブ音が聞こえたら${(captureProfile.warmupMs / 1000).toFixed(1)}秒待ち、`,
        `その後、通常の声量で約${measurementSeconds}秒間話し続けてください。`,
      ]
    : []
  const answer = await prompt.question(
    [
      `CoreS3から約${playbackSeconds}秒間、AW88298 -${captureProfile.hardwareAttenuationDb} dBで小さな広帯域プローブ音を再生します。`,
      `開始前に${(captureProfile.startDelayMs / 1000).toFixed(1)}秒待機し、取得後は-${captureProfile.safeHardwareAttenuationDb} dBへ戻して無音ファームウェアを再書き込みします。`,
      ...doubleTalkInstructions,
      `対象: ${uploadPort}`,
      '続けるには yes と入力してください: ',
    ].join('\n'),
  )
  prompt.close()
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('中止しました。')
    process.exit(0)
  }
}

mkdirSync(outputDirectory, { recursive: true })
const rawLogPath = replayLogPath ? resolve(replayLogPath) : join(outputDirectory, 'xsbug-raw.log')
let captureFirmwareDeployed = false
let bridge
let logServer
let interruptCapture
let interrupted = false

function runManifest(manifest, label) {
  console.log(`[aec-waveform] ${label}`)
  const result = spawnSync(
    process.execPath,
    [
      resolve(firmwareDirectory, 'scripts/run-mcconfig.mjs'),
      '-d',
      '-m',
      '-p',
      'esp32/m5stack_cores3',
      '-t',
      'deploy',
      manifest,
    ],
    {
      cwd: firmwareDirectory,
      env: process.env,
      stdio: 'inherit',
    },
  )
  if (result.status !== 0) throw new Error(`${label}に失敗しました`)
}

function stopBridge() {
  if (!bridge?.pid || bridge.killed) return
  try {
    process.kill(-bridge.pid, 'SIGTERM')
  } catch {
    bridge.kill('SIGTERM')
  }
}

async function collectCapture() {
  logServer = startXsbugServer(rawLogPath)
  const xsbugPort = await logServer.ready
  const shownMarkers = new Set()

  bridge = spawn(serialBridge, [uploadPort, serialSpeed, '8N1'], {
    detached: true,
    env: {
      ...process.env,
      XSBUG_HOST: '127.0.0.1',
      XSBUG_PORT: String(xsbugPort),
    },
    stdio: 'ignore',
  })

  console.log(
    `[aec-waveform] ${uploadPort} から取得中です。プローブ音は接続後${(captureProfile.startDelayMs / 1000).toFixed(
      1,
    )}秒で始まります。`,
  )
  if (doubleTalkRequested)
    console.log(
      `[aec-waveform] 音が聞こえたら${(captureProfile.warmupMs / 1000).toFixed(1)}秒待ち、通常の声量で約${(
        captureProfile.captureSamples / 16000
      ).toFixed(1)}秒間話してください。`,
    )

  return await new Promise((resolveCapture, rejectCapture) => {
    let settled = false
    const finish = (error, decoded) => {
      if (settled) return
      settled = true
      interruptCapture = undefined
      clearInterval(poll)
      clearTimeout(timeout)
      if (error) rejectCapture(error)
      else resolveCapture(decoded)
    }

    bridge.on('error', (error) => finish(new Error(`serial2xsbugを起動できません: ${error.message}`)))
    bridge.on('exit', (code, signal) => {
      if (!settled)
        finish(new Error(`serial2xsbugが途中終了しました: code=${code ?? 'null'} signal=${signal ?? 'null'}`))
    })

    const poll = setInterval(() => {
      const decoded = decodeXsbugLog(logServer.getLog())
      for (const marker of [
        'AEC_WAVEFORM_ARMED',
        'AEC_WAVEFORM_WARMUP',
        'AEC_WAVEFORM_MEASURE',
        'AEC_WAVEFORM_BEGIN',
        'AEC_WAVEFORM_END',
      ]) {
        if (!shownMarkers.has(marker) && decoded.includes(marker)) {
          shownMarkers.add(marker)
          const line = decoded.split('\n').find((candidate) => candidate.startsWith(marker))
          console.log(`[device] ${line ?? marker}`)
        }
      }

      if (/AEC_WAVEFORM_END /.test(decoded)) finish(undefined, decoded)
      else if (/# Exception|# exception|stack overflow|Guru Meditation|AEC waveform capture incomplete/i.test(decoded))
        finish(new Error('実機側で波形取得エラーが発生しました'))
    }, 100)

    const timeout = setTimeout(() => finish(new Error(`${timeoutMs} ms以内に波形取得が終了しませんでした`)), timeoutMs)
    interruptCapture = () => finish(new Error('ユーザー操作で波形取得を中止しました'))
  })
}

function positiveInteger(value, name) {
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    console.error(`${name} は正の整数で指定してください: ${value}`)
    process.exit(1)
  }
  return Number.parseInt(String(value), 10)
}

function parseCapture(decoded) {
  const beginMatch = decoded.match(/^AEC_WAVEFORM_BEGIN (.+)$/m)
  const endMatch = decoded.match(/^AEC_WAVEFORM_END (.+)$/m)
  if (!beginMatch || !endMatch) throw new Error('波形取得メタデータがログにありません')

  const metadata = JSON.parse(beginMatch[1])
  const result = JSON.parse(endMatch[1])
  const chunks = Array.from(
    decoded.matchAll(/^AEC_WAVEFORM_CHUNK ([0-9]+) ([A-Za-z0-9+/=]+)$/gm),
    ([, index, base64]) => ({ index: Number.parseInt(index, 10), bytes: Buffer.from(base64, 'base64') }),
  ).sort((left, right) => left.index - right.index)

  for (let index = 0; index < chunks.length; index += 1) {
    if (chunks[index].index !== index) throw new Error(`診断チャンク${index}が欠落しています`)
  }
  if (chunks.length !== result.chunks)
    throw new Error(`診断チャンク数が一致しません: ${chunks.length}/${result.chunks}`)

  const diagnostics = Buffer.concat(chunks.map((chunk) => chunk.bytes))
  const expectedBytes = result.capturedSamples * 3 * Int16Array.BYTES_PER_ELEMENT
  if (diagnostics.length !== expectedBytes)
    throw new Error(`診断データ長が一致しません: ${diagnostics.length}/${expectedBytes}`)

  const raw = new Int16Array(result.capturedSamples)
  const reference = new Int16Array(result.capturedSamples)
  const clean = new Int16Array(result.capturedSamples)
  for (let sample = 0; sample < result.capturedSamples; sample += 1) {
    const offset = sample * 3 * Int16Array.BYTES_PER_ELEMENT
    raw[sample] = diagnostics.readInt16LE(offset)
    reference[sample] = diagnostics.readInt16LE(offset + 2)
    clean[sample] = diagnostics.readInt16LE(offset + 4)
  }

  return { metadata, result, diagnostics, raw, reference, clean }
}

function signalEnergy(samples) {
  let energy = 0
  let peak = 0
  for (const sample of samples) {
    energy += sample * sample
    const magnitude = Math.abs(sample)
    if (peak < magnitude) peak = magnitude
  }
  return { energy, peak, rms: Math.sqrt(energy / samples.length) }
}

function correlation(left, right) {
  let leftEnergy = 0
  let rightEnergy = 0
  let cross = 0
  for (let index = 0; index < left.length; index += 1) {
    leftEnergy += left[index] * left[index]
    rightEnergy += right[index] * right[index]
    cross += left[index] * right[index]
  }
  return {
    normalized: leftEnergy && rightEnergy ? cross / Math.sqrt(leftEnergy * rightEnergy) : 0,
    cross,
  }
}

function analyzeSignals(raw, reference, clean) {
  const rawLevel = signalEnergy(raw)
  const referenceLevel = signalEnergy(reference)
  const cleanLevel = signalEnergy(clean)
  const rawReference = correlation(raw, reference)
  const cleanReference = correlation(clean, reference)
  return {
    raw: rawLevel,
    reference: referenceLevel,
    clean: cleanLevel,
    rawToCleanEnergyReductionDb: 10 * Math.log10((rawLevel.energy + 1) / (cleanLevel.energy + 1)),
    rawReferenceCorrelation: rawReference.normalized,
    cleanReferenceCorrelation: cleanReference.normalized,
    correlatedEchoSuppressionDb:
      20 * Math.log10((Math.abs(rawReference.cross) + 1) / (Math.abs(cleanReference.cross) + 1)),
  }
}

function createWav(samples, sampleRate) {
  const dataBytes = samples.length * Int16Array.BYTES_PER_ELEMENT
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index += 1) wav.writeInt16LE(samples[index], 44 + index * 2)
  return wav
}

function envelope(samples, bins = 1200) {
  const values = []
  const count = Math.min(samples.length, bins)
  for (let bin = 0; bin < count; bin += 1) {
    const start = Math.floor((bin * samples.length) / count)
    const end = Math.max(start + 1, Math.floor(((bin + 1) * samples.length) / count))
    let minimum = 32767
    let maximum = -32768
    for (let index = start; index < end; index += 1) {
      if (samples[index] < minimum) minimum = samples[index]
      if (maximum < samples[index]) maximum = samples[index]
    }
    values.push([minimum, maximum])
  }
  return values
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function waveformPath(values, left, top, width, height, scale) {
  const middle = top + height / 2
  return values
    .map(([minimum, maximum], index) => {
      const x = left + (index * width) / Math.max(1, values.length - 1)
      const yMinimum = middle - (minimum / scale) * (height / 2)
      const yMaximum = middle - (maximum / scale) * (height / 2)
      return `M${x.toFixed(2)} ${yMinimum.toFixed(2)}V${yMaximum.toFixed(2)}`
    })
    .join('')
}

function createWaveformSvg(raw, reference, clean, sampleRate) {
  const width = 1280
  const height = 720
  const left = 76
  const plotWidth = width - left - 28
  const plotHeight = 230
  const referenceEnvelope = envelope(reference)
  const rawEnvelope = envelope(raw)
  const cleanEnvelope = envelope(clean)
  const referenceScale = Math.max(1, ...referenceEnvelope.flat().map(Math.abs))
  const microphoneScale = Math.max(1, ...rawEnvelope.flat().map(Math.abs), ...cleanEnvelope.flat().map(Math.abs))
  const durationSeconds = raw.length / sampleRate

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#101318"/>
  <style>
    text { fill: #d9e1ea; font-family: system-ui, sans-serif; }
    .grid { stroke: #33404d; stroke-width: 1; }
  </style>
  <text x="${left}" y="34" font-size="22">CoreS3 AudioDuplex AEC waveform capture</text>
  <text x="${left}" y="61" font-size="14">duration ${durationSeconds.toFixed(3)} s · 16 kHz mono · same-run comparison</text>
  <rect x="${left}" y="84" width="${plotWidth}" height="${plotHeight}" fill="#171d24"/>
  <line class="grid" x1="${left}" y1="${84 + plotHeight / 2}" x2="${left + plotWidth}" y2="${84 + plotHeight / 2}"/>
  <path d="${waveformPath(referenceEnvelope, left, 84, plotWidth, plotHeight, referenceScale)}" stroke="#c8a951" stroke-width="1" fill="none"/>
  <text x="12" y="${84 + plotHeight / 2}" font-size="14">reference</text>
  <text x="${left}" y="332" font-size="13">±${referenceScale} PCM</text>
  <rect x="${left}" y="376" width="${plotWidth}" height="${plotHeight}" fill="#171d24"/>
  <line class="grid" x1="${left}" y1="${376 + plotHeight / 2}" x2="${left + plotWidth}" y2="${376 + plotHeight / 2}"/>
  <path d="${waveformPath(rawEnvelope, left, 376, plotWidth, plotHeight, microphoneScale)}" stroke="#f07178" stroke-width="1" fill="none" opacity="0.85"/>
  <path d="${waveformPath(cleanEnvelope, left, 376, plotWidth, plotHeight, microphoneScale)}" stroke="#59c2ff" stroke-width="1" fill="none" opacity="0.95"/>
  <text x="12" y="${376 + plotHeight / 2 - 10}" font-size="14" fill="#f07178">raw / OFF</text>
  <text x="12" y="${376 + plotHeight / 2 + 14}" font-size="14" fill="#59c2ff">AEC ON</text>
  <text x="${left}" y="624" font-size="13">shared scale ±${microphoneScale} PCM</text>
  <line x1="${left}" y1="665" x2="${left + 42}" y2="665" stroke="#f07178" stroke-width="3"/>
  <text x="${left + 50}" y="670" font-size="14">raw microphone (AEC-off equivalent)</text>
  <line x1="${left + 370}" y1="665" x2="${left + 412}" y2="665" stroke="#59c2ff" stroke-width="3"/>
  <text x="${left + 420}" y="670" font-size="14">AEC output</text>
  <text x="${left}" y="704" font-size="12">The raw and AEC signals were captured simultaneously before and after the same AEC process.</text>
</svg>
`
}

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits)
}

function createHtml(metadata, result, metrics) {
  const rows = [
    ['Duration', `${formatNumber(result.capturedSamples / metadata.sampleRate, 3)} s`],
    [
      'Reference delay',
      `${metadata.referenceDelaySamples} samples (${formatNumber((metadata.referenceDelaySamples * 1000) / metadata.sampleRate, 2)} ms)`,
    ],
    ['Raw microphone RMS', formatNumber(metrics.raw.rms)],
    ['AEC output RMS', formatNumber(metrics.clean.rms)],
    ['Raw → AEC energy reduction', `${formatNumber(metrics.rawToCleanEnergyReductionDb)} dB`],
    ['Raw/reference correlation', formatNumber(metrics.rawReferenceCorrelation, 4)],
    ['AEC/reference correlation', formatNumber(metrics.cleanReferenceCorrelation, 4)],
    ['Correlated echo suppression', `${formatNumber(metrics.correlatedEchoSuppressionDb)} dB`],
    ['Raw / AEC peak', `${metrics.raw.peak} / ${metrics.clean.peak}`],
    ['Capture attenuation', `AW88298 −${metadata.hardwareAttenuationDb} dB`],
    ['Post-capture attenuation', `AW88298 −${metadata.safeHardwareAttenuationDb} dB`],
  ]
    .map(([label, value]) => `<tr><th>${escapeXml(label)}</th><td>${escapeXml(value)}</td></tr>`)
    .join('\n')

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CoreS3 AEC waveform report</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #101318; color: #d9e1ea; }
    body { max-width: 1280px; margin: 2rem auto; padding: 0 1.25rem 3rem; }
    h1 { font-size: 1.7rem; }
    .note { background: #171d24; border-left: 4px solid #59c2ff; padding: .8rem 1rem; }
    img { width: 100%; height: auto; border: 1px solid #33404d; }
    table { border-collapse: collapse; margin: 1.25rem 0; }
    th, td { border-bottom: 1px solid #33404d; padding: .5rem .8rem; text-align: left; }
    th { color: #9fb0c0; }
    .audio { display: grid; gap: .8rem; margin-top: 1.25rem; }
    audio { width: min(680px, 100%); }
    code { color: #c8a951; }
  </style>
</head>
<body>
  <h1>CoreS3 AudioDuplex AEC 波形レポート</h1>
  <p class="note">赤はAEC直前の生マイク信号（AEC OFF相当）、青は同じ瞬間のAEC出力です。別録りではないため、部屋の雑音や再生タイミングの差を含まない比較です。</p>
  <img src="waveforms.svg" alt="AEC reference, raw microphone, and clean output waveforms">
  <table>${rows}</table>
  <div class="audio">
    <label>生マイク／AEC OFF相当<br><audio controls src="raw-microphone-aec-off-equivalent.wav"></audio></label>
    <label>AEC ON<br><audio controls src="aec-on.wav"></audio></label>
    <label>AECへ渡した遅延済みスピーカー参照<br><audio controls src="speaker-reference-delayed.wav"></audio></label>
  </div>
  <p>WAVは実測PCMを正規化せず保存しています。再生時はPC側の音量を低くしてから調整してください。</p>
  <p>詳細値は <code>capture.json</code>、生の三信号インターリーブデータは <code>diagnostics.pcm</code> にあります。</p>
</body>
</html>
`
}

let decoded
let primaryError
process.once('SIGINT', () => {
  interrupted = true
  console.error('\n[aec-waveform] 中止要求を受けました。安全ファームウェアへ戻します。')
  stopBridge()
  interruptCapture?.()
})

if (replayLogPath) {
  decoded = decodeXsbugLog(readFileSync(rawLogPath, 'utf8'))
  console.log(`[aec-waveform] 保存済みログを再解析します: ${rawLogPath}`)
} else {
  try {
    runManifest(captureManifest, '波形取得ファームウェアをビルド・書き込み中')
    captureFirmwareDeployed = true
    if (interrupted) throw new Error('ユーザー操作で波形取得を中止しました')
    decoded = await collectCapture()
  } catch (error) {
    primaryError = error
  } finally {
    stopBridge()
    if (logServer) await logServer.close()
    bridge = undefined
    logServer = undefined

    if (captureFirmwareDeployed) {
      try {
        runManifest(safeManifest, '無音スモークファームウェアへ復帰中')
        console.log('[aec-waveform] 実機をデジタル音量0・アンプ-96 dBのファームウェアへ戻しました。')
      } catch (restoreError) {
        primaryError ??= restoreError
        console.error(`[aec-waveform] 安全ファームウェアへの復帰に失敗しました: ${restoreError.message}`)
      }
    }
  }
}

if (primaryError) {
  console.error(`[aec-waveform] ${primaryError.message}`)
  console.error(`[aec-waveform] ログ: ${rawLogPath}`)
  process.exit(1)
}

try {
  const capture = parseCapture(decoded)
  const metrics = analyzeSignals(capture.raw, capture.reference, capture.clean)
  writeFileSync(join(outputDirectory, 'diagnostics.pcm'), capture.diagnostics)
  writeFileSync(
    join(outputDirectory, 'raw-microphone-aec-off-equivalent.wav'),
    createWav(capture.raw, capture.metadata.sampleRate),
  )
  writeFileSync(
    join(outputDirectory, 'speaker-reference-delayed.wav'),
    createWav(capture.reference, capture.metadata.sampleRate),
  )
  writeFileSync(join(outputDirectory, 'aec-on.wav'), createWav(capture.clean, capture.metadata.sampleRate))
  writeFileSync(
    join(outputDirectory, 'waveforms.svg'),
    createWaveformSvg(capture.raw, capture.reference, capture.clean, capture.metadata.sampleRate),
  )
  writeFileSync(
    join(outputDirectory, 'capture.json'),
    `${JSON.stringify({ metadata: capture.metadata, result: capture.result, metrics }, null, 2)}\n`,
  )
  writeFileSync(join(outputDirectory, 'report.html'), createHtml(capture.metadata, capture.result, metrics))

  console.log(`[aec-waveform] レポート: ${join(outputDirectory, 'report.html')}`)
  console.log(
    `[aec-waveform] RMS ${formatNumber(metrics.raw.rms)} → ${formatNumber(metrics.clean.rms)}, energy reduction ${formatNumber(metrics.rawToCleanEnergyReductionDb)} dB, correlated suppression ${formatNumber(metrics.correlatedEchoSuppressionDb)} dB`,
  )
} catch (error) {
  console.error(`[aec-waveform] 取得ログの解析に失敗しました: ${error.message}`)
  console.error(`[aec-waveform] ログ: ${rawLogPath}`)
  process.exit(1)
}
