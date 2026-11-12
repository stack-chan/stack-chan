#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePartitionTable } from '../../web/editor/esptool-installer.mjs'
import { buildOutputDirectory } from './lib/build-output.mjs'
import { esptoolConnectionArguments, partitionTableOffset, partitionTableSize } from './lib/mod-flash.mjs'
import {
  createSanoModelHeader,
  findSanoModelPartition,
  sanottsModelFormat,
  validateSanoModelPayload,
} from './lib/sanotts-model-image.mjs'

/**
 * Install into a live-validated dedicated partition, keeping the device in the
 * ROM loader until the final header verification. Never accesses xs/storage.
 * A failure before header programming leaves the model uncommitted. A failure
 * during/after header programming has an uncertain outcome; do not auto-retry.
 */
export function installSanoModel({
  modelPath = fileURLToPath(new URL('../dist/models/sanotts/sanotts-v4.bin', import.meta.url)),
  port,
  baud,
  chip = 'esp32s3',
  temporaryDirectory = path.join(buildOutputDirectory, 'tmp'),
  runCommand = executeCommand,
} = {}) {
  if (chip !== 'esp32s3') throw new Error('sanoTTS model installation requires ESP32-S3')
  // Snapshot once: changing the input file later cannot bypass validation.
  const payload = readFileSync(modelPath)
  const metadata = validateSanoModelPayload(payload)
  const header = createSanoModelHeader(payload)
  const connection = esptoolConnectionArguments({ chip, port, baud })
  mkdirSync(temporaryDirectory, { recursive: true })
  const scratch = mkdtempSync(path.join(temporaryDirectory, 'stackchan-sanotts-model-'))
  let commitAttempted = false
  try {
    const tablePath = path.join(scratch, 'partition-table.bin')
    const payloadPath = path.join(scratch, 'model.bin')
    const headerPath = path.join(scratch, 'header.bin')
    writeFileSync(payloadPath, payload)
    writeFileSync(headerPath, header)
    runCommand('esptool', [
      ...connection,
      '--after',
      'no-reset',
      'read-flash',
      hex(partitionTableOffset),
      hex(partitionTableSize),
      tablePath,
    ])
    const table = readFileSync(tablePath)
    // The shared web parser returns layout fields only. Retain the flags here:
    // raw model updates must not target encrypted/read-only partitions.
    const partitions = parsePartitionTable(table).map((entry, index) => ({
      ...entry,
      flags: table.readUInt32LE(index * 32 + 28),
    }))
    const partition = findSanoModelPartition(partitions)
    const payloadAddress = partition.offset + sanottsModelFormat.payloadOffset
    runCommand('esptool', [
      ...connection,
      '--after',
      'no-reset',
      'erase-region',
      hex(partition.offset),
      hex(partition.size),
    ])
    runCommand('esptool', [
      ...connection,
      '--after',
      'no-reset',
      'write-flash',
      '--flash-size',
      'keep',
      '--flash-mode',
      'keep',
      '--flash-freq',
      'keep',
      hex(payloadAddress),
      payloadPath,
    ])
    runCommand('esptool', [...connection, '--after', 'no-reset', 'verify-flash', hex(payloadAddress), payloadPath])
    commitAttempted = true
    runCommand('esptool', [
      ...connection,
      '--after',
      'no-reset',
      'write-flash',
      '--flash-size',
      'keep',
      '--flash-mode',
      'keep',
      '--flash-freq',
      'keep',
      hex(partition.offset),
      headerPath,
    ])
    runCommand('esptool', [...connection, '--after', 'hard-reset', 'verify-flash', hex(partition.offset), headerPath])
    console.log(`[stack-chan] sanoTTS model installed: ${metadata.byteLength} bytes, SHA256 ${metadata.sha256}`)
    return { ...metadata, partition, payloadAddress }
  } catch (cause) {
    const error = new Error(
      commitAttempted
        ? 'sanoTTS model commit outcome is uncertain; inspect the partition before retrying'
        : 'sanoTTS model installation stopped before header commit',
      { cause },
    )
    error.commitAttempted = commitAttempted
    throw error
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function hex(value) {
  return `0x${value.toString(16)}`
}

function executeCommand(command, args) {
  console.log(`[stack-chan] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw new Error(`Failed to run ${command}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
}

function main(args) {
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const option = args[index]
    const key = { '--model': 'modelPath', '--port': 'port', '--baud': 'baud' }[option]
    if (!key || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Usage: install-sanotts-model.mjs [--model path] [--port port] [--baud baud]')
    options[key] = args[++index]
  }
  installSanoModel(options)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`[stack-chan] ${error.message}${error.cause ? `: ${error.cause.message}` : ''}`)
    process.exitCode = 1
  }
}
