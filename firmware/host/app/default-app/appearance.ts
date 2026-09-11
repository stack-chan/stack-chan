import type { AppContext, Emotion } from 'stackchan/app'
import { input } from 'stackchan/extensions/input'
import { type Emoticon, type FaceStyle, type HandAnimation, ui } from 'stackchan/extensions/ui'
import type { Unsubscribe } from 'stackchan/task'

export function installAppearance(app: AppContext, onManualEmotion: () => void | Promise<void>) {
  const view = ui(app)
  const label = (key: string) => view.localize(`drawer.${key}`)
  const effects: Partial<Record<Emotion, Emoticon>> = {
    happy: 'heart',
    angry: 'angry',
    sad: 'tear',
    hot: 'sweat',
    sleepy: 'sleepy',
  }
  let selectedEmotion: Emotion = 'neutral'
  let cancelReaction: Unsubscribe | undefined
  const showEmotion = (emotion: Emotion) => {
    app.face.setEmotion(emotion)
    view.setEmoticon(effects[emotion] ?? null)
    emotionControl.setValue(emotion)
  }
  const emotionControl = view.addChoice<Emotion>(
    {
      id: 'emotion',
      label: label('emotion'),
      value: selectedEmotion,
      options: (['neutral', 'happy', 'angry', 'sad', 'hot', 'sleepy'] as const).map((value) => ({
        value,
        label: label(`emotion.${value}`),
      })),
    },
    async (emotion) => {
      cancelReaction?.()
      await onManualEmotion()
      selectedEmotion = emotion
      showEmotion(emotion)
    },
  )
  view.addChoice<FaceStyle>(
    {
      id: 'face',
      label: label('face'),
      value: 'default',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'avatar', label: 'Avatar' },
        ...(['simple', 'dog', 'image'] as const).map((value) => ({ value, label: label(`face.${value}`) })),
      ],
    },
    (style) => view.setFaceStyle(style),
  )
  view.addChoice<HandAnimation>(
    {
      id: 'hands',
      label: '手',
      value: 'none',
      options: [
        { value: 'none', label: '無し' },
        { value: 'rock-paper-scissors', label: 'グーチョキパー' },
        { value: 'clap', label: '拍手' },
        { value: 'thinking', label: '考え中' },
      ],
    },
    (animation) => {
      view.setHandAnimation(animation)
      view.closeMenu()
    },
  )
  view.addToggle({ id: 'balloon', label: label('balloon'), value: false }, (visible) => {
    if (visible) view.showBalloon('Hello from Stack-chan')
    else view.hideBalloon()
  })
  let colorMode: 'light' | 'dark' = 'light'
  const setColor = (mode: typeof colorMode) => {
    const primary = mode === 'light' ? 255 : 0
    const secondary = 255 - primary
    app.face.setColor('primary', { r: primary, g: primary, b: primary })
    app.face.setColor('secondary', { r: secondary, g: secondary, b: secondary })
    colorMode = mode
    colorControl.setValue(mode)
  }
  const colorControl = view.addChoice(
    {
      id: 'colors',
      label: label('colorScheme'),
      value: colorMode,
      options: [
        { value: 'light' as const, label: label('color.light'), color: '#ffffff' },
        { value: 'dark' as const, label: label('color.dark'), color: '#000000' },
      ],
    },
    setColor,
  )
  if (app.capabilities.get('input.tertiary').availability !== 'unavailable')
    input(app).onPress('tertiary', () => setColor(colorMode === 'light' ? 'dark' : 'light'))
  return {
    react(emotion: Emotion, durationMs: number) {
      cancelReaction?.()
      showEmotion(emotion)
      cancelReaction = app.time.after(durationMs, () => showEmotion(selectedEmotion))
    },
  }
}
