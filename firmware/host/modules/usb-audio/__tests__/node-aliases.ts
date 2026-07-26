import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../../testing/node-alias-package.js'

export function installUsbAudioTestAliases(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const usbAudioRoot = resolve(hostRoot, 'modules/usb-audio')
  writeAliasPackage(hostRoot, 'stackchan-usb-media-session', resolve(usbAudioRoot, 'media-session.js'))
  writeAliasPackage(hostRoot, 'stackchan-usb-event-transport', resolve(usbAudioRoot, 'event-transport.js'))
}
