import * as Blockly from 'blockly'
import { z } from 'zod'
import { TOOLBOX } from '../../../editor/blocks.mjs'
import { toolboxForTarget } from '../../../editor/capabilities.mjs'
import { MAX_PROJECT_JSON_BYTES } from '../../../editor/project-format.mjs'
import { ToolError } from '@/services/webmcp/runtime'

const id = z.string().min(1).max(128)
const fields = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]))
export const blockCommandSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('create'),
      id,
      type: z.string().min(1),
      fields: fields.optional(),
      extraState: z.record(z.string(), z.json()).optional(),
      x: z.number().finite().optional(),
      y: z.number().finite().optional(),
    })
    .strict(),
  z.object({ op: z.literal('set_fields'), id, fields }).strict(),
  z.object({ op: z.literal('set_extra_state'), id, extraState: z.record(z.string(), z.json()) }).strict(),
  z.object({ op: z.literal('connect'), id, parentId: id, input: z.string().optional() }).strict(),
  z.object({ op: z.literal('disconnect'), id }).strict(),
  z.object({ op: z.literal('move'), id, x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ op: z.literal('delete'), id, healStack: z.boolean().default(true) }).strict(),
  z
    .object({ op: z.literal('create_variable'), id, name: z.string().min(1).max(128), type: z.string().default('') })
    .strict(),
  z.object({ op: z.literal('rename_variable'), id, name: z.string().min(1).max(128) }).strict(),
  z.object({ op: z.literal('delete_variable'), id }).strict(),
])
export const blockCommandsSchema = z.array(blockCommandSchema).min(1).max(100)
export type BlockCommand = z.infer<typeof blockCommandSchema>

export function blockTypesForTarget(target: string): Set<string> {
  const types = new Set<string>()
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if ('type' in value && typeof value.type === 'string') types.add(value.type)
    if ('custom' in value && value.custom === 'VARIABLE')
      ['variables_get', 'variables_set', 'math_change'].forEach((type) => types.add(type))
    if ('custom' in value && value.custom === 'PROCEDURE')
      [
        'procedures_defnoreturn',
        'procedures_defreturn',
        'procedures_callnoreturn',
        'procedures_callreturn',
        'procedures_ifreturn',
      ].forEach((type) => types.add(type))
    Object.values(value).forEach(visit)
  }
  visit(toolboxForTarget(TOOLBOX, target))
  return types
}

function requireBlock(workspace: Blockly.Workspace, id: string) {
  const block = workspace.getBlockById(id)
  if (!block) throw new ToolError('block_not_found', `ブロックが見つかりません: ${id}`)
  return block
}

function setFields(block: Blockly.Block, values: Record<string, string | number | boolean>) {
  for (const [name, value] of Object.entries(values)) {
    const field = block.getField(name)
    if (!field || !field.EDITABLE) throw new ToolError('invalid_field', `編集可能なフィールドではありません: ${name}`)
    if (field instanceof Blockly.FieldVariable && !block.workspace.getVariableMap().getVariableById(String(value))) {
      throw new ToolError('variable_not_found', '先に変数を作成してください。')
    }
    block.setFieldValue(value, name)
    if (String(block.getFieldValue(name)).toLowerCase() !== String(value).toLowerCase()) {
      throw new ToolError('invalid_field_value', `フィールドの値が許容範囲外です: ${name}`)
    }
  }
}

function mutationText(block: Blockly.Block) {
  return block.saveExtraState ? JSON.stringify(block.saveExtraState()) : Blockly.Xml.domToText(block.mutationToDom!())
}

function executeCommands(workspace: Blockly.Workspace, commands: BlockCommand[], allowed: Set<string>) {
  for (const command of commands) {
    if (command.op === 'create_variable') {
      if (
        workspace.getVariableMap().getVariableById(command.id) ||
        workspace.getVariableMap().getVariable(command.name, command.type)
      )
        throw new ToolError('duplicate_variable', '同じ変数が既にあります。')
      workspace.getVariableMap().createVariable(command.name, command.type, command.id)
      continue
    }
    if (command.op === 'rename_variable' || command.op === 'delete_variable') {
      const variable = workspace.getVariableMap().getVariableById(command.id)
      if (!variable) throw new ToolError('variable_not_found', '変数が見つかりません。')
      if (command.op === 'rename_variable') workspace.getVariableMap().renameVariable(variable, command.name)
      else {
        if (Blockly.Variables.getVariableUsesById(workspace, command.id).length)
          throw new ToolError('variable_in_use', '使用中の変数は削除できません。')
        workspace.getVariableMap().deleteVariable(variable)
      }
      continue
    }
    if (command.op === 'create') {
      if (!allowed.has(command.type))
        throw new ToolError(
          'unsupported_block',
          `この機種で使用できるブロックをカタログから選んでください: ${command.type}`
        )
      if (workspace.getBlockById(command.id))
        throw new ToolError('duplicate_block', `ブロック ID が重複しています: ${command.id}`)
      // Explicit IDs are stable references for subsequent commands in this batch.
      const block = Blockly.serialization.blocks.append(
        { type: command.type, id: command.id, extraState: command.extraState, x: command.x, y: command.y },
        workspace,
        { recordUndo: true }
      )
      if (command.fields) setFields(block, command.fields)
      continue
    }
    const block = requireBlock(workspace, command.id)
    switch (command.op) {
      case 'set_fields':
        setFields(block, command.fields)
        break
      case 'set_extra_state': {
        if (!block.loadExtraState) throw new ToolError('invalid_extra_state', 'このブロックには可変入力がありません。')
        const oldValue = mutationText(block)
        block.loadExtraState(command.extraState)
        const newValue = mutationText(block)
        if (oldValue !== newValue)
          Blockly.Events.fire(new Blockly.Events.BlockChange(block, 'mutation', null, oldValue, newValue))
        break
      }
      case 'connect': {
        const parent = requireBlock(workspace, command.parentId)
        const destination =
          command.input === undefined ? parent.nextConnection : parent.getInput(command.input)?.connection
        const source =
          destination?.type === Blockly.ConnectionType.INPUT_VALUE ? block.outputConnection : block.previousConnection
        if (!destination || !source || !workspace.connectionChecker.canConnect(source, destination, false))
          throw new ToolError('invalid_connection', '指定したブロック同士は接続できません。')
        if (block === parent || block.getDescendants(false).includes(parent))
          throw new ToolError('invalid_connection', '循環する接続は作成できません。')
        // Replacing a real input must be explicit; shadows are replaceable defaults.
        const occupant = destination.targetBlock()
        if (occupant && !occupant.isShadow() && occupant !== block)
          throw new ToolError('occupied_connection', '接続先を先に切り離してください。')
        block.unplug(false)
        source.connect(destination)
        break
      }
      case 'disconnect':
        block.unplug(false)
        break
      case 'move': {
        if (block.getParent())
          throw new ToolError('connected_block', '接続したブロックの位置は親ブロックで変更してください。')
        const position = block.getRelativeToSurfaceXY()
        block.moveBy(command.x - position.x, command.y - position.y)
        break
      }
      case 'delete':
        block.dispose(command.healStack)
        break
    }
  }
}

export function applyBlockCommands(workspace: Blockly.Workspace, commands: BlockCommand[], target: string) {
  // Mutators allocate inputs from counts; reject oversized values before invoking Blockly.
  const inspect = (value: unknown, depth = 0): void => {
    if (depth > 20 || (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 100)))
      throw new ToolError('invalid_extra_state', '可変入力の数または深さが上限を超えています。')
    if (value && typeof value === 'object') {
      if (Object.keys(value).length > 100)
        throw new ToolError('invalid_extra_state', '可変入力の数が上限を超えています。')
      Object.values(value).forEach((child) => inspect(child, depth + 1))
    }
  }
  for (const command of commands) if ('extraState' in command) inspect(command.extraState)
  const before = Blockly.serialization.workspaces.save(workspace)
  const allowed = blockTypesForTarget(target)
  const scratch = new Blockly.Workspace()
  Blockly.Events.disable()
  try {
    Blockly.serialization.workspaces.load(before, scratch)
    executeCommands(scratch, commands, allowed)
    const after = Blockly.serialization.workspaces.save(scratch)
    if (new TextEncoder().encode(JSON.stringify(after)).length > MAX_PROJECT_JSON_BYTES)
      throw new ToolError('too_large', 'ワークスペースのサイズが上限を超えています。')
  } finally {
    scratch.dispose()
    Blockly.Events.enable()
  }
  const group = Blockly.Events.getGroup()
  Blockly.Events.setGroup(true)
  try {
    executeCommands(workspace, commands, allowed)
  } finally {
    Blockly.Events.setGroup(group)
  }
  return commands.filter((command) => command.op === 'create').map((command) => command.id)
}

export function blockCatalog(target: string) {
  const workspace = new Blockly.Workspace()
  Blockly.Events.disable()
  try {
    return [...blockTypesForTarget(target)].map((type) => {
      const block = Blockly.serialization.blocks.append({ type }, workspace)
      const result = {
        type,
        description: block.getTooltip(),
        extraState: block.saveExtraState?.() ?? null,
        fields: block.inputList.flatMap((input) =>
          input.fieldRow
            .filter((field) => field.name && field.EDITABLE)
            .map((field) => ({
              name: field.name,
              value: field.getValue(),
              ...(field instanceof Blockly.FieldVariable
                ? { variableReference: true }
                : field instanceof Blockly.FieldDropdown
                  ? {
                      options: field
                        .getOptions(false)
                        .map(([label, value]) => ({ label: typeof label === 'string' ? label : value, value })),
                    }
                  : {}),
              ...(field instanceof Blockly.FieldNumber
                ? {
                    min: Number.isFinite(field.getMin()) ? field.getMin() : null,
                    max: Number.isFinite(field.getMax()) ? field.getMax() : null,
                    precision: field.getPrecision(),
                  }
                : {}),
            }))
        ),
        inputs: block.inputList
          .filter((input) => input.connection)
          .map((input) => ({
            name: input.name,
            kind: input.connection?.type === Blockly.ConnectionType.INPUT_VALUE ? 'value' : 'statement',
            check: input.connection?.getCheck(),
          })),
        previous: Boolean(block.previousConnection),
        next: Boolean(block.nextConnection),
        output: block.outputConnection?.getCheck() ?? null,
      }
      block.dispose(false)
      return result
    })
  } finally {
    workspace.dispose()
    Blockly.Events.enable()
  }
}
