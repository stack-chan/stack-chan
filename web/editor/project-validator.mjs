import { BLOCK_CAPABILITIES, profileFor, requirementsForBlockTypes } from './capabilities.mjs'

const EVENT_BLOCKS = new Set([
  'stackchan_on_start',
  'stackchan_on_button',
  'stackchan_on_imu',
  'stackchan_on_head_touch',
  'stackchan_on_drawer_button',
  'stackchan_every',
])
const ALLOWED_TOP_LEVEL_BLOCKS = new Set([...EVENT_BLOCKS, 'procedures_defreturn', 'procedures_defnoreturn'])
const LEGACY_SONG_EVENT_BLOCKS = new Set(['stackchan_song_note', 'stackchan_song_rest'])

function fieldIdentity(field) {
  if (field && typeof field === 'object') return String(field.id ?? field.name ?? '')
  return String(field ?? '')
}

function visitBlock(block, result, parentId = null) {
  if (!block || typeof block !== 'object') return
  const item = {
    id: block.id ?? null,
    type: block.type ?? 'unknown',
    parentId,
    fields: block.fields ?? {},
    extraState: block.extraState ?? {},
  }
  result.push(item)
  for (const input of Object.values(block.inputs ?? {})) {
    visitBlock(input.block, result, item.id)
    visitBlock(input.shadow, result, item.id)
  }
  visitBlock(block.next?.block, result, parentId)
}

export function flattenWorkspace(workspace) {
  const blocks = []
  for (const block of workspace?.blocks?.blocks ?? []) visitBlock(block, blocks)
  return blocks
}

export function analyzeWorkspace(workspace, { target = 'm5stackchan-cores3' } = {}) {
  const blocks = flattenWorkspace(workspace)
  const topBlocks = workspace?.blocks?.blocks ?? []
  const diagnostics = []
  const blockById = new Map(blocks.filter((block) => block.id !== null).map((block) => [block.id, block]))

  if (blocks.length === 0) {
    diagnostics.push({ severity: 'error', code: 'VP_EMPTY', message: 'ブロックを一つ以上配置してください' })
  }

  for (const block of topBlocks) {
    if (!ALLOWED_TOP_LEVEL_BLOCKS.has(block.type) && !LEGACY_SONG_EVENT_BLOCKS.has(block.type)) {
      diagnostics.push({
        severity: 'error',
        code: 'VP_ORPHAN_TOP_LEVEL',
        blockId: block.id ?? null,
        message: '処理ブロックをイベントブロックの内側へ接続してください',
      })
    }
  }

  for (const block of blocks.filter((item) => LEGACY_SONG_EVENT_BLOCKS.has(item.type))) {
    if (blockById.get(block.parentId)?.type === 'stackchan_sing') continue
    diagnostics.push({
      severity: 'error',
      code: 'VP_LEGACY_SONG_EVENT',
      blockId: block.id,
      message: '旧形式の音符・休符は直接実行できません。トリプル形式のブロックをリストへ入れてください',
    })
  }

  for (const block of blocks) {
    if (block.type === 'controls_whileUntil') {
      diagnostics.push({
        severity: 'warning',
        code: 'VP_UNBOUNDED_LOOP',
        blockId: block.id,
        message: '条件ループは停止しない可能性があります。シミュレーターで確認してください',
      })
    }
  }

  for (const variable of workspace?.variables ?? []) {
    const id = String(variable.id ?? variable.name ?? '')
    const references = blocks.filter((block) => fieldIdentity(block.fields?.VAR) === id)
    if (references.length === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'VP_UNUSED_VARIABLE',
        message: `変数「${variable.name ?? id}」はブロックから使われていません`,
      })
    } else if (references.every((block) => block.type === 'variables_set')) {
      diagnostics.push({
        severity: 'warning',
        code: 'VP_WRITE_ONLY_VARIABLE',
        blockId: references[0].id,
        message: `変数「${variable.name ?? id}」には値を入れていますが、読み出していません`,
      })
    }
  }

  const calls = new Set(
    blocks
      .filter((block) => block.type === 'procedures_callreturn' || block.type === 'procedures_callnoreturn')
      .map((block) => fieldIdentity(block.fields?.NAME ?? block.extraState?.name))
  )
  for (const definition of blocks.filter(
    (block) => block.type === 'procedures_defreturn' || block.type === 'procedures_defnoreturn'
  )) {
    const name = fieldIdentity(definition.fields?.NAME)
    if (!calls.has(name)) {
      diagnostics.push({
        severity: 'warning',
        code: 'VP_UNUSED_PROCEDURE',
        blockId: definition.id,
        message: `関数「${name || '名前なし'}」は呼び出されていません`,
      })
    }
  }

  const requirements = requirementsForBlockTypes(blocks.map((block) => block.type))
  const supported = new Set(profileFor(target).capabilities)
  for (const capability of requirements) {
    if (supported.has(capability)) continue
    const source = blocks.find((block) => BLOCK_CAPABILITIES[block.type]?.includes(capability))
    diagnostics.push({
      severity: 'error',
      code: 'VP_UNSUPPORTED_CAPABILITY',
      blockId: source?.id ?? null,
      capability,
      message: `${profileFor(target).label}は「${capability}」に対応していません`,
    })
  }

  return {
    blocks,
    requirements,
    diagnostics,
    canBuild: !diagnostics.some((item) => item.severity === 'error'),
  }
}
