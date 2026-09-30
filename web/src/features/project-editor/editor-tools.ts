import { useRef } from 'react'
import { z } from 'zod'
import { DEVICE_PROFILES, profileFor } from '../../../editor/capabilities.mjs'
import { blockCommandsSchema } from './block-commands'
import { type useProjectEditor } from './use-project-editor'
import { type VisualProject } from './project-types'
import { useBeforeNavigate, useOperations, useWebMcpTools } from '@/services/webmcp/react'
import { emptyInput, expectedRevision, Revision, ToolError } from '@/services/webmcp/runtime'

const target = z.enum(Object.keys(DEVICE_PROFILES) as [string, ...string[]])
const versioned = z.object({ expectedRevision }).strict()

export function useEditorTools(editor: ReturnType<typeof useProjectEditor>) {
  useBeforeNavigate(() => editor.flushSave())
  const revision = useRef(new Revision()).current
  const operations = useOperations()
  const revisionInput = () => {
    const { createdAt: _created, updatedAt: _updated, ...project } = editor.getCurrent().project
    return project
  }
  const state = () => ({ ...editor.getCurrent(), revision: revision.read(revisionInput()) })
  const check = (expected: string) => {
    revision.check(expected, revisionInput())
    if (editor.getCurrent().deviceBusy) throw new ToolError('busy', '実機の操作が終わってから再実行してください。')
  }
  const requireResult = (result: { ok: boolean; code?: string }) => {
    if (!result.ok)
      throw new ToolError(
        result.code ?? 'operation_failed',
        '操作を実行できませんでした。診断と画面の状態を確認してください。'
      )
    return result
  }
  useWebMcpTools([
    {
      name: 'stackchan.editor.get_project',
      description:
        'Read the visible project, Blockly IDs and connections, generated source, diagnostics, simulator state and revision.',
      schema: emptyInput,
      readOnly: true,
      untrusted: true,
      execute: state,
    },
    {
      name: 'stackchan.editor.get_catalog',
      description:
        'List target-specific block types, field choices, input connection names and default extraState. Includes variables and procedures. Create variables before referencing their IDs.',
      schema: emptyInput,
      readOnly: true,
      execute: () => ({ targets: DEVICE_PROFILES, samples: editor.samples, blocks: editor.getWorkspace().catalog() }),
    },
    {
      name: 'stackchan.editor.create_project',
      description:
        'Create and open a new project, keeping the previous project in the library. Omit sampleId to start empty.',
      schema: z
        .object({ expectedRevision, name: z.string().min(1).max(64), target, sampleId: z.string().optional() })
        .strict(),
      untrusted: true,
      execute: ({ expectedRevision: expected, name, target, sampleId }) => {
        check(expected)
        if (sampleId && !editor.samples.some((sample) => sample.id === sampleId))
          throw new ToolError('not_found', 'サンプルが見つかりません。')
        editor.newProject()
        editor.updateProject({ name, target })
        editor.getWorkspace().setTarget(target)
        if (sampleId) editor.loadSample(sampleId)
        else editor.clearWorkspace()
        return state()
      },
    },
    {
      name: 'stackchan.editor.update_project',
      description: 'Change project name, target, or asset settings. Other project content is preserved.',
      schema: z
        .object({
          expectedRevision,
          changes: z
            .object({
              name: z.string().min(1).max(64).optional(),
              target: target.optional(),
              settings: z
                .object({ embedAssets: z.boolean().optional(), faceAsset: z.string().nullable().optional() })
                .strict()
                .optional(),
            })
            .strict(),
        })
        .strict(),
      untrusted: true,
      execute: ({ expectedRevision: expected, changes }) => {
        check(expected)
        const current = editor.getCurrent().project
        const next: Partial<VisualProject> = {
          ...changes,
          ...(changes.settings ? { settings: { ...current.settings, ...changes.settings } } : {}),
        }
        editor.updateProject(next)
        if (changes.target) editor.getWorkspace().setTarget(changes.target)
        return state()
      },
    },
    {
      name: 'stackchan.editor.edit_blocks',
      description:
        'Apply an atomic, undoable batch of block edits. Supply unique IDs for created blocks. connect uses a named parent input, or parent next when input is omitted. Disconnect occupied real connections explicitly. delete heals the surrounding statement stack by default.',
      schema: z.object({ expectedRevision, commands: blockCommandsSchema }).strict(),
      untrusted: true,
      execute: ({ expectedRevision: expected, commands }) => {
        check(expected)
        const createdIds = editor.getWorkspace().editBlocks(commands)
        return { ...state(), createdIds }
      },
    },
    {
      name: 'stackchan.editor.validate',
      description: 'Read current project diagnostics and whether it can be built.',
      schema: emptyInput,
      readOnly: true,
      untrusted: true,
      execute: () => ({ revision: state().revision, ...editor.getCurrent().analysis }),
    },
    {
      name: 'stackchan.editor.build',
      description:
        'Build the current project. Returns an operation ID; query its result before starting the simulator or installing.',
      schema: versioned,
      execute: ({ expectedRevision: expected }) => {
        check(expected)
        return operations.start('ビルド', async ({ signal }) => requireResult(await editor.build(signal)))
      },
    },
    {
      name: 'stackchan.editor.run_simulator',
      description:
        'Start the built MOD in the visible simulator. The operation succeeds when WASM reports ready, and returns running; later runtime errors appear in get_project.',
      schema: versioned,
      execute: ({ expectedRevision: expected }) => {
        check(expected)
        return operations.start('シミュレーターで実行', ({ signal }) => editor.startSimulator(signal))
      },
    },
    {
      name: 'stackchan.editor.stop_simulator',
      description: 'Stop and close the visible project simulator.',
      schema: emptyInput,
      execute: () => {
        editor.closeSimulator()
        return { status: 'stopped' }
      },
    },
    {
      name: 'stackchan.editor.press_button',
      description: 'Press simulator button a, b or c to exercise the running MOD.',
      schema: z.object({ button: z.enum(['a', 'b', 'c']) }).strict(),
      execute: ({ button }) => {
        editor.pressSimulatorButton(button)
        return { pressed: button }
      },
    },
    ...(['install', 'remove'] as const).map((action) => ({
      name: `stackchan.editor.request_${action}_mod`,
      description:
        action === 'install'
          ? 'Prepare installing the built MOD. The user selects USB and confirms the detected device on screen. Query the operation for the verified write result.'
          : 'Prepare removal of the device MOD. The user selects USB and confirms the detected device on screen. Query the operation for the verified result.',
      schema: versioned,
      consequential: true,
      execute: ({ expectedRevision: expected }: { expectedRevision: string }) => {
        check(expected)
        if (!('serial' in navigator) || !profileFor(editor.getCurrent().project.target).deviceInstall)
          throw new ToolError('unsupported', 'この対象機種またはブラウザーでは実機操作を利用できません。')
        if (action === 'install' && !editor.getCurrent().archiveReady)
          throw new ToolError('not_ready', '先に現在のプロジェクトをビルドしてください。')
        return operations.start(
          action === 'install' ? '実機へ書き込み' : '実機のMODを削除',
          async (context) => {
            const options = { ...context, guard: () => revision.check(expected, revisionInput()) }
            const result =
              action === 'install' ? await editor.installToDevice(options) : await editor.removeFromDevice(options)
            return requireResult(result)
          },
          'USBデバイスを選択'
        )
      },
    })),
  ])
}
