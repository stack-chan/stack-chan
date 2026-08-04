import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../../../modules/testing/node-alias-package.js'

export function installRemoteSessionTestAliases(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const remoteSessionRoot = resolve(hostRoot, 'app/remote-session')
  writeAliasPackage(hostRoot, 'stackchan-application-event', resolve(remoteSessionRoot, 'application-event.js'))
  writeAliasPackage(
    hostRoot,
    'stackchan-approval-session',
    resolve(remoteSessionRoot, '__tests__/approval-session-fake.js'),
  )
  writeAliasPackage(hostRoot, 'stackchan-conversation-session', resolve(remoteSessionRoot, 'conversation-session.js'))
  writeAliasPackage(hostRoot, 'stackchan-realtime-session', resolve(remoteSessionRoot, 'realtime-session.js'))
  writeAliasPackage(hostRoot, 'stackchan-task-session', resolve(remoteSessionRoot, 'task-session.js'))
  writeAliasPackage(hostRoot, 'stackchan-remote-session-facade', resolve(remoteSessionRoot, 'facade.js'))
}
