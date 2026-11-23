export const ChatState = Object.freeze({
  FAILED: 0,
  DISCONNECTED: 1,
  DISCONNECTING: 2,
  CONNECTING: 3,
  CONNECTED: 4,
  SPEAKING: 5,
  LISTENING: 6,
  WAITING: 7,
} as const)

export type ChatState = (typeof ChatState)[keyof typeof ChatState]

const chatStateNames = Object.freeze([
  'FAILED',
  'DISCONNECTED',
  'DISCONNECTING',
  'CONNECTING',
  'CONNECTED',
  'SPEAKING',
  'LISTENING',
  'WAITING',
] as const)
export type ChatStateName = (typeof chatStateNames)[number]
export const ChatStateNames: readonly ChatStateName[] = chatStateNames

export function chatStateToName(state: ChatState): ChatStateName {
  return chatStateNames[state] ?? 'DISCONNECTED'
}
