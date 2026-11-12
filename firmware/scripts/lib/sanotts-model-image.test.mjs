import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { installSanoModel } from '../install-sanotts-model.mjs'
import {
  createSanoModelHeader,
  findSanoModelPartition,
  sanottsModelFormat as format,
  validateSanoModelPartition,
  validateSanoModelPayload,
} from './sanotts-model-image.mjs'

const modelPath = fileURLToPath(new URL('../../dist/models/sanotts/sanotts-v4.bin', import.meta.url))
const model = existsSync(modelPath) ? readFileSync(modelPath) : undefined
const needsModel = { skip: model ? false : 'Fetch the pinned model with scripts/fetch-sanotts-model.mjs' }

function layout() {
  return [
    { label: 'nvs', type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
    { label: 'phy_init', type: 1, subtype: 1, offset: 0xf000, size: 0x1000 },
    { label: 'factory', type: 0, subtype: 0, offset: 0x10000, size: 0xee0000 },
    { label: 'sanotts_model', type: 1, subtype: 0x40, offset: 0xef0000, size: 0xb0000 },
    { label: 'xs', type: 0x40, subtype: 1, offset: 0xfa0000, size: 0x40000 },
    { label: 'storage', type: 1, subtype: 0x82, offset: 0xfe0000, size: 0x10000 },
  ]
}

function table(entries) {
  const bytes = Buffer.alloc(0xc00, 255)
  entries.forEach((entry, index) => {
    const position = index * 32
    bytes.writeUInt16LE(0x50aa, position)
    bytes[position + 2] = entry.type
    bytes[position + 3] = entry.subtype
    bytes.writeUInt32LE(entry.offset, position + 4)
    bytes.writeUInt32LE(entry.size, position + 8)
    bytes.fill(0, position + 12, position + 32)
    bytes.write(entry.label, position + 12, 16, 'ascii')
    bytes.writeUInt32LE(entry.flags ?? 0, position + 28)
  })
  return bytes
}

function image() {
  const bytes = Buffer.alloc(format.partitionSize, 255)
  model.copy(bytes, format.payloadOffset)
  createSanoModelHeader(model).copy(bytes)
  return bytes
}

function fixture({ entries = layout(), fail, mutateSource } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sanotts-model-install-'))
  const input = path.join(directory, 'source.bin')
  writeFileSync(input, model)
  const memory = Buffer.alloc(format.partitionSize, 0)
  const calls = []
  const scratchPaths = []
  const commands = ['read-flash', 'erase-region', 'write-flash', 'verify-flash']
  let writes = 0
  let verifies = 0
  return {
    directory,
    memory,
    calls,
    scratchPaths,
    options: {
      modelPath: input,
      port: 'test-port',
      baud: 921600,
      temporaryDirectory: directory,
      runCommand(command, args) {
        assert.equal(command, 'esptool')
        const action = args.find((arg) => commands.includes(arg))
        calls.push({ action, args })
        if (action === 'read-flash') {
          assert.equal(Number(args.at(-3)), 0x8000)
          assert.equal(Number(args.at(-2)), 0xc00)
          writeFileSync(args.at(-1), table(entries))
          scratchPaths.push(args.at(-1))
          if (mutateSource) writeFileSync(input, Buffer.alloc(model.length))
          return
        }
        const position = Number(args.at(-2)) - format.partitionOffset
        if (action === 'erase-region') {
          assert.equal(position, 0)
          assert.equal(Number(args.at(-1)), memory.length)
          memory.fill(255)
          if (fail === 'erase') throw new Error('injected erase failure')
        } else {
          const bytes = readFileSync(args.at(-1))
          assert.ok(position >= 0 && position + bytes.length <= memory.length, 'must not touch host/MOD/storage')
          if (action === 'write-flash') {
            writes++
            if (fail === 'payload-write' && writes === 1) {
              bytes.subarray(0, 100).copy(memory, position)
              throw new Error('injected partial payload write')
            }
            if (fail === 'header-write' && writes === 2) {
              bytes.subarray(0, 32).copy(memory, position)
              throw new Error('injected partial header write')
            }
            bytes.copy(memory, position)
          } else {
            verifies++
            assert.deepEqual(memory.subarray(position, position + bytes.length), bytes)
            if (fail === 'payload-verify' && verifies === 1) throw new Error('injected payload verify failure')
            if (fail === 'header-verify' && verifies === 2) throw new Error('injected header verify failure')
          }
        }
      },
    },
    close() {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('payload validates the pinned length and digest for a Uint8Array view', needsModel, () => {
  const backing = new Uint8Array(model.length + 2)
  backing.set(model, 1)
  const info = validateSanoModelPayload(backing.subarray(1, -1))
  assert.equal(info.byteLength, model.length)
  assert.equal(info.sha256, format.sha256)
})

test('rejects incompatible input types, incorrect lengths and unrecognized payloads', () => {
  for (const input of [null, [], new ArrayBuffer(format.payloadBytes)])
    assert.throws(() => validateSanoModelPayload(input), TypeError)
  assert.throws(() => validateSanoModelPayload(Buffer.alloc(0)), /length/)
  assert.throws(() => validateSanoModelPayload(Buffer.alloc(format.payloadBytes - 1)), /length/)
  assert.throws(() => validateSanoModelPayload(Buffer.alloc(format.payloadBytes + 1)), /length/)
  assert.throws(() => validateSanoModelPayload(Buffer.alloc(format.payloadBytes)), /SHA-256 mismatch/)
})

test('modified model bytes are rejected by the pinned digest', needsModel, () => {
  for (const position of [0, Math.floor(model.length / 2), model.length - 1]) {
    const corrupt = Buffer.from(model)
    corrupt[position] ^= 1
    assert.throws(() => validateSanoModelPayload(corrupt), /SHA-256 mismatch/)
  }
})

test('committed model round trips with aligned payload and rejects every partial header prefix', needsModel, () => {
  const bytes = image()
  assert.equal(format.payloadOffset % 16, 0)
  assert.deepEqual(validateSanoModelPartition(bytes), validateSanoModelPayload(model))
  for (let count = 0; count < format.headerBytes; count++) {
    const partial = Buffer.from(bytes)
    partial.fill(255, count, format.headerBytes)
    assert.throws(() => validateSanoModelPartition(partial), /Uncommitted/)
  }
})

test('erased, truncated, modified header and partially written payload are never valid', needsModel, () => {
  assert.throws(() => validateSanoModelPartition(Buffer.alloc(format.partitionSize, 255)), /Uncommitted/)
  assert.throws(() => validateSanoModelPartition(image().subarray(0, -1)), /length/)
  for (const position of [0, 8, 12, 16, 20, 24, 55, 56, 63, format.payloadOffset + 8192]) {
    const bytes = image()
    bytes[position] ^= 1
    assert.throws(() => validateSanoModelPartition(bytes), /Uncommitted|mismatch/)
  }
})

test('only the dedicated layout is admitted, preserving host/MOD/storage bounds', () => {
  assert.equal(findSanoModelPartition(layout()).label, format.partitionLabel)
  const mutations = [
    (entries) => entries.splice(3, 1),
    (entries) => {
      entries[3].type = 0x40
    },
    (entries) => {
      entries[3].subtype = 1
    },
    (entries) => {
      entries[3].offset -= 4096
    },
    (entries) => {
      entries[3].size -= 4096
    },
    (entries) => {
      entries[3].flags = 1
    },
    (entries) => {
      entries[3].flags = 2
    },
    (entries) => {
      entries[2].size = 0xf90000
    },
    (entries) => {
      entries[4].size += 4096
    },
    (entries) => {
      entries[5].offset += 4096
    },
    (entries) => entries.push({ ...entries[3] }),
    (entries) => entries.push({ label: 'other', type: 1, subtype: 0x40, offset: 0x1000000, size: 4096 }),
  ]
  for (const mutate of mutations) {
    const entries = layout()
    mutate(entries)
    assert.throws(() => findSanoModelPartition(entries), /partition|layout/)
  }
})

test('repository partition CSV and installer agree on model/MOD/storage layout', () => {
  const csv = readFileSync(new URL('../../host/modules/audio/sanotts-jp/partitions.csv', import.meta.url), 'utf8')
  const types = { app: 0, data: 1 }
  const subtypes = { nvs: 2, phy: 1, factory: 0, spiffs: 0x82 }
  const entries = csv
    .split(/\r?\n/)
    .map((line) => line.split('#', 1)[0].trim())
    .filter(Boolean)
    .map((line) => {
      const [label, type, subtype, offset, size, flags] = line.split(',').map((value) => value.trim())
      return {
        label,
        type: types[type] ?? Number(type),
        subtype: subtypes[subtype] ?? Number(subtype),
        offset: Number(offset),
        size: Number(size),
        flags: flags ? Number(flags) : 0,
      }
    })
  assert.equal(findSanoModelPartition(entries).label, format.partitionLabel)
  assert.deepEqual(
    entries.filter((entry) => ['xs', 'storage'].includes(entry.label)),
    layout()
      .filter((entry) => ['xs', 'storage'].includes(entry.label))
      .map((entry) => ({ ...entry, flags: 0 })),
  )
})

test('installer erases only dedicated storage and commits only after payload verification', needsModel, () => {
  const state = fixture()
  try {
    const result = installSanoModel(state.options)
    assert.deepEqual(
      state.calls.map((call) => call.action),
      ['read-flash', 'erase-region', 'write-flash', 'verify-flash', 'write-flash', 'verify-flash'],
    )
    assert.ok(state.calls.slice(0, -1).every((call) => call.args.includes('no-reset')))
    assert.ok(state.calls.at(-1).args.includes('hard-reset'))
    assert.ok(state.calls.every((call) => call.args.includes('test-port') && call.args.includes('921600')))
    assert.deepEqual(validateSanoModelPartition(state.memory), validateSanoModelPayload(model))
    assert.equal(result.partition.offset, format.partitionOffset)
    assert.equal(result.payloadAddress, format.partitionOffset + format.payloadOffset)
    assert.ok(state.scratchPaths.every((filename) => !existsSync(path.dirname(filename))))
  } finally {
    state.close()
  }
})

test('replacing an installed model preserves commit-last invariants and source-file snapshot', needsModel, () => {
  const state = fixture({ mutateSource: true })
  try {
    image().copy(state.memory)
    installSanoModel(state.options)
    assert.equal(validateSanoModelPartition(state.memory).sha256, format.sha256)
  } finally {
    state.close()
  }
})

for (const failure of ['erase', 'payload-write', 'payload-verify']) {
  test(`installer ${failure} failure leaves no valid header and never attempts commit`, needsModel, () => {
    const state = fixture({ fail: failure })
    try {
      assert.throws(
        () => installSanoModel(state.options),
        (error) => {
          assert.equal(error.commitAttempted, false)
          return true
        },
      )
      assert.throws(() => validateSanoModelPartition(state.memory), /Uncommitted/)
      assert.ok(state.calls.every((call) => call.args.includes('no-reset')))
      assert.ok(state.scratchPaths.every((filename) => !existsSync(path.dirname(filename))))
    } finally {
      state.close()
    }
  })
}

for (const failure of ['header-write', 'header-verify']) {
  test(`installer ${failure} failure reports uncertain outcome without automatic retry`, needsModel, () => {
    const state = fixture({ fail: failure })
    try {
      assert.throws(
        () => installSanoModel(state.options),
        (error) => {
          assert.equal(error.commitAttempted, true)
          assert.match(error.message, /uncertain/)
          return true
        },
      )
      assert.equal(state.calls.filter((call) => call.action === 'erase-region').length, 1)
      assert.equal(state.calls.filter((call) => call.action === 'write-flash').length, 2)
      if (failure === 'header-write') assert.throws(() => validateSanoModelPartition(state.memory), /Uncommitted/)
      else assert.equal(validateSanoModelPartition(state.memory).sha256, format.sha256)
    } finally {
      state.close()
    }
  })
}

test('wrong live layout never erases or writes', needsModel, () => {
  const entries = layout()
  entries.splice(3, 1)
  entries[2].size = 0xf90000
  const state = fixture({ entries })
  try {
    assert.throws(() => installSanoModel(state.options), /before header commit/)
    assert.deepEqual(
      state.calls.map((call) => call.action),
      ['read-flash'],
    )
  } finally {
    state.close()
  }
})

test('live encrypted/read-only/unknown model flags are rejected before erase', needsModel, () => {
  for (const flags of [1, 2, 3, 0x80000000]) {
    const entries = layout()
    entries[3].flags = flags
    const state = fixture({ entries })
    try {
      assert.throws(() => installSanoModel(state.options), /before header commit/)
      assert.deepEqual(
        state.calls.map((call) => call.action),
        ['read-flash'],
      )
    } finally {
      state.close()
    }
  }
})

test('bad local model and wrong chip never connect to any serial device', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sanotts-model-preflight-'))
  try {
    const filename = path.join(directory, 'bad.bin')
    writeFileSync(filename, Buffer.alloc(format.payloadBytes))
    let calls = 0
    const options = {
      modelPath: filename,
      temporaryDirectory: directory,
      runCommand() {
        calls++
      },
    }
    assert.throws(() => installSanoModel(options), /SHA-256 mismatch/)
    assert.throws(() => installSanoModel({ ...options, chip: 'esp32' }), /ESP32-S3/)
    assert.equal(calls, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
