import { useRef } from 'react'
import { z } from 'zod'
import { useI18n } from '@/app/i18n-provider'
import { useOperations, useWebMcpTools } from '@/services/webmcp/react'
import { emptyInput, expectedRevision, Revision, ToolError } from '@/services/webmcp/runtime'
import { PREFERENCE_FIELDS, PREFERENCE_KEYS, validPreferenceValue, type PreferenceKey } from './preference-model'
import { type usePreferences } from './use-preferences'

type Preferences = ReturnType<typeof usePreferences>
export function redactPreferences(state: ReturnType<Preferences['getState']>) {
  return {
    connected: state.connected,
    dirty: state.dirty,
    readOnly: state.readOnly,
    sending: state.sending,
    fields: Object.fromEntries(
      PREFERENCE_KEYS.map((key) => [
        key,
        {
          received: Object.hasOwn(state.received, key),
          ...(PREFERENCE_FIELDS[key].secret
            ? {
                secret: true,
                hasValue: Boolean(state.values[key]),
                deviceHasValue: Object.hasOwn(state.received, key) ? Boolean(state.received[key]) : null,
              }
            : { value: state.values[key], deviceValue: state.received[key] ?? null }),
        },
      ])
    ),
  }
}

function resultOrThrow<T extends { ok: boolean; code?: string }>(result: T | undefined) {
  if (!result?.ok)
    throw new ToolError(result?.code ?? 'not_ready', '設定操作を実行できませんでした。接続と設定値を確認してください。')
  return result
}

export function usePreferenceTools(preferences: Preferences, confirmClear: (signal: AbortSignal) => Promise<boolean>) {
  const { t } = useI18n()
  const revision = useRef(new Revision()).current
  const operations = useOperations()
  const get = () => preferences.getState()
  const state = () => ({ ...redactPreferences(get()), revision: revision.read(get()) })
  const check = (expected: string) => {
    revision.check(expected, get())
    if (!get().connected) throw new ToolError('not_connected', 'BLE で接続してから操作してください。')
    if (get().sending) throw new ToolError('busy', '設定を送信中です。')
  }
  useWebMcpTools([
    {
      name: 'stackchan.preferences.get',
      description:
        'Read settings, received device values, dirty and read-only fields, connection state and revision. Secrets are represented only by presence flags.',
      schema: emptyInput,
      readOnly: true,
      untrusted: true,
      execute: state,
    },
    {
      name: 'stackchan.preferences.get_schema',
      description: 'List supported setting keys, choices, numeric constraints and secret fields.',
      schema: emptyInput,
      readOnly: true,
      execute: () =>
        Object.fromEntries(
          PREFERENCE_KEYS.map((key) => [key, { ...PREFERENCE_FIELDS[key], label: t(PREFERENCE_FIELDS[key].label) }])
        ),
    },
    {
      name: 'stackchan.preferences.update',
      description:
        'Edit settings in the visible form without sending them. Values use the same string representation as the form. Returns a redacted snapshot.',
      schema: z.object({ expectedRevision, changes: z.partialRecord(z.enum(PREFERENCE_KEYS), z.string()) }).strict(),
      untrusted: true,
      execute: ({
        expectedRevision: expected,
        changes,
      }: {
        expectedRevision: string
        changes: Partial<Record<PreferenceKey, string>>
      }) => {
        check(expected)
        const entries = Object.entries(changes) as [PreferenceKey, string][]
        for (const [key, value] of entries) {
          if (get().readOnly.includes(key))
            throw new ToolError('read_only', '本体側で固定されている項目は変更できません。')
          if (!validPreferenceValue(key, value)) throw new ToolError('invalid_input', '設定値を確認してください。')
        }
        for (const [key, value] of entries) preferences.update(key, value)
        return state()
      },
    },
    {
      name: 'stackchan.preferences.save',
      description:
        'Send the current dirty settings to the connected robot. The result distinguishes sent keys from keys confirmed by device notifications.',
      schema: z.object({ expectedRevision }).strict(),
      consequential: true,
      execute: ({ expectedRevision: expected }) => {
        check(expected)
        return operations.start('設定を保存', async ({ protect }) => {
          check(expected)
          protect()
          return resultOrThrow(await preferences.save())
        })
      },
    },
    {
      name: 'stackchan.preferences.request_connect',
      description: 'Prepare BLE connection. The user presses the connection button to open the browser device chooser.',
      schema: emptyInput,
      execute: () => {
        if (get().connected) return { status: 'connected' }
        return operations.start(
          'BLEで接続',
          async ({ signal }) => {
            signal.throwIfAborted()
            const result = await preferences.connect()
            if (signal.aborted) {
              await preferences.disconnect()
              signal.throwIfAborted()
            }
            return resultOrThrow(result)
          },
          'BLEで接続'
        )
      },
    },
    {
      name: 'stackchan.preferences.disconnect',
      description: 'Disconnect BLE. Unsaved form edits remain visible.',
      schema: emptyInput,
      execute: async () => {
        if (operations.busy() || get().sending)
          throw new ToolError('busy', '実行中の操作が終わってから切断してください。')
        return resultOrThrow(await preferences.disconnect())
      },
    },
    {
      name: 'stackchan.preferences.request_clear_wifi',
      description:
        'Open the existing Wi-Fi clearing confirmation. Clears SSID and password only after the user confirms on screen.',
      schema: z.object({ expectedRevision }).strict(),
      consequential: true,
      execute: ({ expectedRevision: expected }) => {
        check(expected)
        return operations.start('Wi-Fi設定を消去', async ({ signal, waitForUser, protect }) => {
          if (!(await waitForUser(confirmClear(signal)))) throw new ToolError('cancelled', '操作をキャンセルしました。')
          signal.throwIfAborted()
          check(expected)
          protect()
          return resultOrThrow(await preferences.clearWifi())
        })
      },
    },
  ])
}
