import * as Blockly from 'blockly'
import 'blockly/blocks'
import { javascriptGenerator, Order } from 'blockly/javascript'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerStackchanBlocks, generateModSource } from '../../../editor/blocks.mjs'
import { applyBlockCommands, blockCatalog, blockCommandsSchema } from './block-commands'

vi.mock('../../../i18n.mjs', () => ({ t: (value: string) => value }))

let workspace: Blockly.Workspace
beforeAll(() => registerStackchanBlocks(Blockly, javascriptGenerator, Order))
beforeEach(() => {
  workspace = new Blockly.Workspace()
})
afterEach(() => workspace.dispose())
const apply = (commands: unknown[]) =>
  applyBlockCommands(workspace, blockCommandsSchema.parse(commands), 'm5stackchan-cores3')
const save = () => Blockly.serialization.workspaces.save(workspace)
const settleEvents = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

describe('block editing commands', () => {
  it('creates connected actions that generate runnable source and undo together', async () => {
    await settleEvents()
    workspace.clearUndo()
    apply([
      { op: 'create', id: 'start', type: 'stackchan_on_start' },
      { op: 'create', id: 'smile', type: 'stackchan_set_emotion', fields: { EMOTION: 'HAPPY' } },
      { op: 'connect', id: 'smile', parentId: 'start', input: 'DO' },
    ])
    expect(workspace.getBlockById('smile')!.getParent()!.id).toBe('start')
    expect(generateModSource(javascriptGenerator, workspace)).toContain('Emotion.HAPPY')
    await settleEvents()
    workspace.undo(false)
    expect(workspace.getAllBlocks(false)).toHaveLength(0)
    workspace.undo(true)
    expect(workspace.getBlockById('smile')!.getParent()!.id).toBe('start')
  })

  it('leaves the workspace intact when any command fails', () => {
    apply([{ op: 'create', id: 'start', type: 'stackchan_on_start' }])
    const before = save()
    expect(() =>
      apply([
        { op: 'create', id: 'smile', type: 'stackchan_set_emotion' },
        { op: 'connect', id: 'smile', parentId: 'missing' },
      ])
    ).toThrow()
    expect(save()).toEqual(before)
    expect(() =>
      apply([{ op: 'create', id: 'smile', type: 'stackchan_set_emotion', fields: { EMOTION: 'UNKNOWN' } }])
    ).toThrow()
    expect(save()).toEqual(before)
  })

  it('rejects occupied connections, incompatible inputs, and cycles', () => {
    apply([
      { op: 'create', id: 'a', type: 'controls_repeat_ext' },
      { op: 'create', id: 'b', type: 'controls_repeat_ext' },
      { op: 'create', id: 'c', type: 'stackchan_set_emotion' },
      { op: 'connect', id: 'b', parentId: 'a', input: 'DO' },
    ])
    const before = save()
    expect(() => apply([{ op: 'connect', id: 'a', parentId: 'b', input: 'DO' }])).toThrow()
    expect(() => apply([{ op: 'connect', id: 'c', parentId: 'a', input: 'DO' }])).toThrow()
    expect(() => apply([{ op: 'connect', id: 'c', parentId: 'a', input: 'TIMES' }])).toThrow()
    expect(save()).toEqual(before)
  })

  it('supports variables, dynamic list inputs and procedure parameters', async () => {
    apply([
      { op: 'create_variable', id: 'counter', name: 'count' },
      { op: 'create', id: 'get', type: 'variables_get', fields: { VAR: 'counter' } },
      { op: 'create', id: 'list', type: 'lists_create_with', extraState: { itemCount: 2 } },
      { op: 'connect', id: 'get', parentId: 'list', input: 'ADD0' },
      {
        op: 'create',
        id: 'function',
        type: 'procedures_defnoreturn',
        fields: { NAME: 'greet' },
        extraState: { params: [{ name: 'who', id: 'who-variable' }] },
      },
    ])
    expect(workspace.getBlockById('list')!.getInput('ADD1')).not.toBeNull()
    expect(workspace.getBlockById('function')!.saveExtraState!().params[0].name).toBe('who')
    expect(() => apply([{ op: 'delete_variable', id: 'counter' }])).toThrow()
    await settleEvents()
    apply([{ op: 'set_extra_state', id: 'list', extraState: { itemCount: 3 } }])
    await settleEvents()
    expect(workspace.getBlockById('list')!.getInput('ADD2')).not.toBeNull()
    workspace.undo(false)
    expect(workspace.getBlockById('list')!.getInput('ADD2')).toBeNull()
  })

  it('derives a usable catalog without changing the visible workspace', () => {
    const before = save()
    const catalog = blockCatalog('m5stackchan-cores3')
    expect(catalog.some((entry) => entry.type === 'variables_get')).toBe(true)
    expect(
      catalog.find((entry) => entry.type === 'stackchan_on_start')!.inputs.some((input) => input.name === 'DO')
    ).toBe(true)
    expect(() => JSON.stringify(catalog)).not.toThrow()
    expect(save()).toEqual(before)
  })
})
