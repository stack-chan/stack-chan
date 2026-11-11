import Resource from 'Resource'

let dictionary: InstanceType<typeof Resource> | undefined

/** Read ordinary Japanese with the firmware dictionary into sanoTTS kana notation. */
export function toKana(text: string): string {
  if (typeof text !== 'string') throw new TypeError('Japanese reading requires a string')
  if (text.includes('\0')) throw new RangeError('Japanese reading contains NUL')
  dictionary ??= new Resource('stackchan-ja.aqd')
  return native('xs_sanotts_reading').call(null, dictionary, text)
}
