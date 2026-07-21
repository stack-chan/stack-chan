export const USB_AUDIO_BALLOON_CHARACTER_WIDTH = 8
export const USB_AUDIO_BALLOON_PADDING_X = 18
export const USB_AUDIO_BALLOON_LINES = 2
export const USB_AUDIO_MOUTH_STEP = 0.1
export const USB_AUDIO_MOUTH_POWER_SCALE = 2000

export function formatUsbAudioCaption(text: string, displayWidth = 320): string {
  const columns = Math.max(
    1,
    Math.floor((displayWidth - USB_AUDIO_BALLOON_PADDING_X * 2) / USB_AUDIO_BALLOON_CHARACTER_WIDTH),
  )
  const lines = ['']
  const counts = [0]
  for (const character of text.trim()) {
    if (character === '\r') continue
    if (character === '\n') {
      lines.push('')
      counts.push(0)
    } else {
      const last = lines.length - 1
      if (counts[last] >= columns) {
        lines.push(character)
        counts.push(1)
      } else {
        lines[last] += character
        counts[last] += 1
      }
    }
    while (lines.length > USB_AUDIO_BALLOON_LINES) {
      lines.shift()
      counts.shift()
    }
  }
  return lines.join('\n')
}

export function usbAudioMouthStep(power: number): number {
  if (!Number.isFinite(power) || power <= 0) return 0
  const step = Math.round(power / (USB_AUDIO_MOUTH_POWER_SCALE * USB_AUDIO_MOUTH_STEP))
  return Math.max(0, Math.min(Math.round(1 / USB_AUDIO_MOUTH_STEP), step))
}
