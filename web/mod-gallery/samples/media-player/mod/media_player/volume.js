const LEVELS = [1, 0.5, 0.25, 0]
const KEYS = ['large', 'medium', 'small', 'mute']

/** The saved value stays exact until the user explicitly chooses a preset. */
export function installVolume(context) {
  const { localize } = context.i18n
  const sync = () => {
    const volume = context.audio.volume
    const candidates = volume === 0 ? [0] : LEVELS.slice(0, 3)
    const nearest = candidates.reduce((best, value) =>
      Math.abs(value - volume) < Math.abs(best - volume) ? value : best,
    )
    context.drawer.addDrawerButton({
      key: 'media:volume',
      label: localize('media.volume', { percent: Math.round(volume * 100) }),
      kind: 'choice',
      value: String(nearest),
      options: LEVELS.map((value, index) => ({ value: String(value), label: localize(`media.${KEYS[index]}`) })),
      callback(_context, value) {
        if (!LEVELS.some((level) => String(level) === value)) return
        context.audio.volume = Number(value)
        sync()
      },
    })
  }
  sync()
}
