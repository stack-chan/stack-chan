import { useRef } from 'react'
import { z } from 'zod'
import { useBeforeNavigate, useOperations, useWebMcpTools } from '@/services/webmcp/react'
import { emptyInput, expectedRevision, Revision, ToolError } from '@/services/webmcp/runtime'
import { updateFaceEye } from './face-model'
import { saveFaceDraft } from '../../../face-editor/face-editor-storage.mjs'
import { type useFaceEditor } from './use-face-editor'

const number = z.number().finite()
const eye = z
  .object({
    x: number.optional(),
    y: number.optional(),
    shape: z.enum(['circle', 'roundRect']).optional(),
    radius: number.optional(),
    width: number.optional(),
    height: number.optional(),
    r: number.optional(),
  })
  .strict()
export const facePatchSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    emotion: z.enum(['NEUTRAL', 'HAPPY', 'ANGRY', 'SAD', 'SLEEPY', 'DOUBTFUL', 'COLD', 'HOT']).optional(),
    colors: z
      .object({
        primary: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
        secondary: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
      })
      .strict()
      .optional(),
    mouth: number.optional(),
    canvas: z
      .object({ left: number.optional(), top: number.optional(), width: number.optional(), height: number.optional() })
      .strict()
      .optional(),
    shape: z
      .object({
        eyes: z.object({ left: eye.optional(), right: eye.optional() }).strict().optional(),
        mouth: z
          .object({
            visible: z.boolean().optional(),
            x: number.optional(),
            y: number.optional(),
            minWidth: number.optional(),
            maxWidth: number.optional(),
            minHeight: number.optional(),
            maxHeight: number.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export function useFaceTools(editor: ReturnType<typeof useFaceEditor>) {
  useBeforeNavigate(() => {
    saveFaceDraft(editor.getCurrent())
  })
  const revision = useRef(new Revision()).current
  const operations = useOperations()
  const get = () => ({ asset: editor.getCurrent(), edit: editor.edit })
  const state = () => ({ ...get(), revision: revision.read(get()) })
  useWebMcpTools([
    {
      name: 'stackchan.face.get',
      description:
        'Read the visible Shape face, edit origin and revision. Coordinates are relative to the face canvas.',
      schema: emptyInput,
      readOnly: true,
      untrusted: true,
      execute: state,
    },
    {
      name: 'stackchan.face.update',
      description:
        'Partially update the visible face. Eyelids resize with the eyes; geometry is normalized to fit the canvas. Returns the actual resulting geometry.',
      schema: z.object({ expectedRevision, changes: facePatchSchema }).strict(),
      untrusted: true,
      execute: ({
        expectedRevision: expected,
        changes,
      }: {
        expectedRevision: string
        changes: z.infer<typeof facePatchSchema>
      }) => {
        revision.check(expected, get())
        editor.update((draft) => {
          if (changes.name !== undefined) draft.name = changes.name
          if (changes.emotion !== undefined) draft.emotion = changes.emotion
          if (changes.mouth !== undefined) draft.mouth = changes.mouth
          Object.assign(draft.colors, changes.colors)
          Object.assign(draft.canvas, changes.canvas)
          Object.assign(draft.shape.mouth, changes.shape?.mouth)
          for (const side of ['left', 'right'] as const) {
            const change = changes.shape?.eyes?.[side]
            if (change) updateFaceEye(draft.shape.eyes[side], change)
          }
        })
        return state()
      },
    },
    {
      name: 'stackchan.face.reset',
      description: 'Restore the standard Shape face in this editor.',
      schema: z.object({ expectedRevision }).strict(),
      untrusted: true,
      execute: ({ expectedRevision: expected }) => {
        revision.check(expected, get())
        editor.reset()
        return state()
      },
    },
    {
      name: 'stackchan.face.export',
      description: 'Return the editable face JSON and suggested filename.',
      schema: emptyInput,
      readOnly: true,
      untrusted: true,
      execute: () => ({
        filename: `${editor.getCurrent().name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.stackchan-face.json`,
        json: JSON.stringify(editor.getCurrent(), null, 2),
      }),
    },
    {
      name: 'stackchan.face.use_in_project',
      description:
        'Save this face and open the block editor to apply it to the source project or current project. Read the project after navigation.',
      schema: z.object({ expectedRevision }).strict(),
      execute: ({ expectedRevision: expected }) => {
        revision.check(expected, get())
        if (operations.busy()) throw new ToolError('busy', '実行中の操作が終わってから移動してください。')
        if (!editor.stageForEditor()) throw new ToolError('storage_failed', '顔データを保存できませんでした。')
        return { navigating: 'editor' }
      },
    },
  ])
}
