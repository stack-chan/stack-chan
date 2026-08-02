import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../../../modules/testing/node-alias-package.js'

export function installRemoteSessionTestAliases(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const remoteSessionRoot = resolve(hostRoot, 'app/remote-session')
  writeAliasPackage(hostRoot, 'stackchan-application-event', resolve(remoteSessionRoot, 'application-event.js'))
  writeAliasPackage(hostRoot, 'stackchan-task-session', resolve(remoteSessionRoot, 'task-session.js'))
  writeAliasPackage(hostRoot, 'stackchan-remote-session-facade', resolve(remoteSessionRoot, 'facade.js'))
}
