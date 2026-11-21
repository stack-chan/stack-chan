import { state } from 'startup-error-ports'

export default function startModManager(): Promise<'back'> {
  state.closeEvents.push('mod-manager')
  return new Promise(() => {})
}
