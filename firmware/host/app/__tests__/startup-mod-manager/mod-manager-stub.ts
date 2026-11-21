import { state } from 'startup-error-ports'

export default function startModManager(): Promise<'back'> {
  state.closeEvents.push('mod-manager')
  return Promise.reject(new Error('Injected MOD Manager launch failure'))
}
