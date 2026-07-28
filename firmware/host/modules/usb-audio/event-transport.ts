import { StackChanCapability } from 'stackchan-usb-media-session'

export type UsbEventTransportState = 'disconnected' | 'unsupported' | 'ready'
export type UsbEventSendResult = 'queued' | 'overflow' | Exclude<UsbEventTransportState, 'ready'>

export function usbEventTransportState(
  connected: boolean,
  localCapabilities: number,
  peerCapabilities: number,
): UsbEventTransportState {
  if (!connected) return 'disconnected'
  const bothSupportEvent =
    (localCapabilities & StackChanCapability.EVENT) !== 0 && (peerCapabilities & StackChanCapability.EVENT) !== 0
  return bothSupportEvent ? 'ready' : 'unsupported'
}
