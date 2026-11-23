/// <reference path="../realtimeConversation.d.ts" />
import type { LiveOptions, Signaling } from 'realtimeConversation'

const signaling: Signaling = {
  async createSession() {
    return undefined
  },
  async hangup() {},
}
const accept = (_options: LiveOptions) => {}
accept({ apiKey: 'test', delegation: { kind: 'hosted', model: 'delegate-model' } })
accept({ signaling, delegation: { kind: 'hosted' } })
accept({ signaling, model: 'session-model', delegation: { kind: 'none' } })
accept({
  apiKey: 'test',
  delegation: { kind: 'hosted', model: 'delegate-model' },
  triggers: [
    {
      type: 'decisions',
      event_type: 'session.input_transcript.delta',
      decisions: {
        questions: [
          {
            type: 'choice',
            name: 'gesture',
            instructions: 'Choose a gesture.',
            choices: [{ value: 'none' }, { value: 'nod' }],
          },
        ],
      },
    },
  ] as const,
})
// @ts-expect-error Direct hosted delegation needs a model; no server owns configuration.
accept({ apiKey: 'test', delegation: { kind: 'hosted' } })
// @ts-expect-error Authentication paths are mutually exclusive.
accept({ apiKey: 'test', signaling })
// @ts-expect-error A transport must be configured explicitly.
accept({ delegation: { kind: 'none' } })
