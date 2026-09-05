#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SerialPort } from 'serialport'
import { buildOutputDirectory } from './lib/build-output.mjs'

const serialPath = process.env.UPLOAD_PORT ?? '/dev/ttyACM0'
const baudRate = 460800
const discardedSamples = 5
const outputDirectory = path.join(buildOutputDirectory, 'jitome-face-benchmark')
const logLines = []
const samples = new Map()
const phaseResults = new Map()
let keys = []
let currentPhase = null
let buffer = ''
let finished = false

function metric(sample, name) {
  return Number(sample[name] ?? 0)
}

function statistics(values) {
  if (!values.length) return { mean: 0, min: 0, max: 0 }
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    mean: Math.round((total / values.length) * 100) / 100,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

function summarize() {
  const phases = {}
  for (const [name, allSamples] of samples) {
    const kept = allSamples.slice(discardedSamples)
    phases[name] = {
      samples: allSamples.length,
      analyzedSamples: kept.length,
      cpu0: statistics(kept.map((sample) => metric(sample, 'CPU 0'))),
      cpu1: statistics(kept.map((sample) => metric(sample, 'CPU 1'))),
      framesPerSecond: statistics(kept.map((sample) => metric(sample, 'Frames drawn'))),
      pixelsPerSecond: statistics(kept.map((sample) => metric(sample, 'Pixels drawn'))),
      garbageCollections: statistics(kept.map((sample) => metric(sample, 'Garbage collections'))),
      chunkUsed: statistics(kept.map((sample) => metric(sample, 'Chunk used'))),
      slotUsed: statistics(kept.map((sample) => metric(sample, 'Slot used'))),
      workload: phaseResults.get(name) ?? null,
    }
  }
  return { serialPath, baudRate, discardedSamples, phases }
}

function processLine(line, complete) {
  line = line.replace(/\r$/, '')
  logLines.push(line)
  console.log(line)
  if (line.startsWith('instruments key: ')) {
    keys = line.slice('instruments key: '.length).split(',')
  } else if (line.startsWith('instruments: ') && currentPhase && keys.length) {
    const values = line.slice('instruments: '.length).split(',')
    const sample = Object.fromEntries(keys.map((key, index) => [key, Number(values[index])]))
    samples.get(currentPhase).push(sample)
  } else if (line.startsWith('[JITOME-BENCH] phase=')) {
    currentPhase = line.slice('[JITOME-BENCH] phase='.length)
    if (!samples.has(currentPhase)) samples.set(currentPhase, [])
  } else if (line.startsWith('[JITOME-BENCH] result phase=')) {
    const match = /phase=([^ ]+) elapsed=(\d+) ticks=(\d+) updates=(\d+)/.exec(line)
    if (match)
      phaseResults.set(match[1], {
        elapsed: Number(match[2]),
        ticks: Number(match[3]),
        updates: Number(match[4]),
      })
  } else if (line === '[JITOME-BENCH] complete') {
    currentPhase = null
    setTimeout(complete, 250)
  }
}

function resetDevice() {
  const python = process.env.ESP_IDF_PYTHON ?? 'python3'
  const program = [
    'import serial, sys, time',
    `port = serial.Serial(sys.argv[1], ${baudRate}, timeout=0.2)`,
    'port.dtr = False',
    'port.rts = True',
    'time.sleep(0.01)',
    'port.rts = False',
    'port.close()',
  ].join('\n')
  const result = spawnSync(python, ['-c', program, serialPath], { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`CoreS3 reset failed. Activate the ESP-IDF environment or set ESP_IDF_PYTHON.\n${result.stderr}`)
}

async function main() {
  mkdirSync(outputDirectory, { recursive: true })
  const port = new SerialPort({ path: serialPath, baudRate })
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('JitomeFace benchmark timed out')), 120000)
    const complete = () => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      resolve()
    }
    port.on('data', (data) => {
      buffer += data.toString('utf8')
      let end = buffer.indexOf('\n')
      while (end >= 0) {
        processLine(buffer.slice(0, end), complete)
        buffer = buffer.slice(end + 1)
        end = buffer.indexOf('\n')
      }
    })
    port.on('error', reject)
  })
  await new Promise((resolve) => port.close(resolve))
  const result = summarize()
  writeFileSync(path.join(outputDirectory, 'run.log'), `${logLines.join('\n')}\n`)
  writeFileSync(path.join(outputDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(`[JITOME-BENCH] summary ${JSON.stringify(result)}`)
}

try {
  resetDevice()
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
