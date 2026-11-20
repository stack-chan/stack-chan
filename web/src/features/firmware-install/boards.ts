export type FirmwareBoard = {
  id: string
  label: string
  manifestUrl: string
}

export const FIRMWARE_BOARDS: readonly FirmwareBoard[] = [
  {
    id: 'esp32_m5stack',
    label: 'M5Stack',
    manifestUrl: new URL('./manifest_esp32_m5stack.json', document.baseURI).href,
  },
  {
    id: 'esp32_m5stack_core2',
    label: 'M5Stack Core2',
    manifestUrl: new URL('./manifest_esp32_m5stack_core2.json', document.baseURI).href,
  },
  {
    id: 'esp32_m5stack_cores3',
    label: 'M5Stack CoreS3',
    manifestUrl: new URL('./manifest_esp32_m5stack_cores3.json', document.baseURI).href,
  },
  {
    id: 'esp32_m5stackchan_cores3',
    label: 'M5StackChan CoreS3',
    manifestUrl: new URL('./manifest_esp32_m5stackchan_cores3.json', document.baseURI).href,
  },
]
