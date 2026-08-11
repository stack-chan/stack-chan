import type { MiniAppContext, MiniAppDefinition } from 'capabilities'
import 'piu/MC'
import type { Container as PiuContainer, Label as PiuLabel } from 'piu/MC'

const screenSkin = new Skin({ fill: '#f8fafc' })
const choiceSkin = new Skin({ fill: '#ffffff', borders: { left: 1, right: 1, top: 1, bottom: 1 }, stroke: '#cbd5e1' })
const selectedChoiceSkin = new Skin({
  fill: '#eff6ff',
  borders: { left: 2, right: 2, top: 2, bottom: 2 },
  stroke: '#2563eb',
})
const markSkin = new Skin({ fill: '#2563eb' })
const separatorSkin = new Skin({ fill: '#cbd5e1' })
const buttonSkin = new Skin({ fill: ['#2563eb', '#1d4ed8'] })
const secondaryButtonSkin = new Skin({ fill: ['#e2e8f0', '#cbd5e1'] })
const overlaySkin = new Skin({ fill: '#0f172acc' })
const panelSkin = new Skin({ fill: '#ffffff' })
const noticeSkin = new Skin({ fill: '#0f172c' })

const titleStyle = new Style({ font: '16px Open Sans', color: '#0f172a', horizontal: 'left', vertical: 'middle' })
const bodyStyle = new Style({ font: '16px Open Sans', color: '#475569', horizontal: 'left', vertical: 'middle' })
const choiceStyle = new Style({ font: '16px Open Sans', color: '#0f172a', horizontal: 'left', vertical: 'middle' })
const buttonStyle = new Style({ font: '16px Open Sans', color: '#ffffff', horizontal: 'center', vertical: 'middle' })
const secondaryButtonStyle = new Style({
  font: '16px Open Sans',
  color: '#0f172a',
  horizontal: 'center',
  vertical: 'middle',
})
const noticeStyle = new Style({ font: '16px Open Sans', color: '#ffffff', horizontal: 'center', vertical: 'middle' })

type ChoiceData = Readonly<{
  value: string
  onSelect(value: string): void
}>

class ChoiceBehavior extends Behavior {
  #data?: ChoiceData

  onCreate(container: PiuContainer, data: ChoiceData): void {
    this.#data = data
    this.setSelected(container, false)
  }

  onTouchEnded(_container: PiuContainer): void {
    if (this.#data) this.#data.onSelect(this.#data.value)
  }

  setSelected(container: PiuContainer, selected: boolean): void {
    container.skin = selected ? selectedChoiceSkin : choiceSkin
    const mark = container.first
    if (mark) mark.visible = selected
  }
}

type ButtonData = Readonly<{ onTap(): void }>

class ButtonBehavior extends Behavior {
  #data?: ButtonData

  onCreate(_container: PiuContainer, data: ButtonData): void {
    this.#data = data
  }

  onTouchBegan(container: PiuContainer): void {
    container.state = 1
  }

  onTouchCancelled(container: PiuContainer): void {
    container.state = 0
  }

  onTouchEnded(container: PiuContainer): void {
    container.state = 0
    this.#data?.onTap()
  }
}

class NoticeBehavior extends Behavior {
  show(label: PiuLabel, message: string): void {
    label.stop()
    label.string = message
    label.visible = true
    label.duration = 1400
    label.time = 0
    label.start()
  }

  onFinished(label: PiuLabel): void {
    label.visible = false
  }
}

function createChoice(label: string, value: string, onSelect: (value: string) => void): PiuContainer {
  return new Container(
    { value, onSelect },
    {
      name: `choice:${value}`,
      left: 0,
      right: 0,
      height: 30,
      active: true,
      Behavior: ChoiceBehavior,
      contents: [
        new Content(null, { name: `mark:${value}`, left: 8, top: 9, width: 12, height: 12, skin: markSkin }),
        new Label(null, { left: 28, right: 8, top: 0, bottom: 0, string: label, style: choiceStyle }),
      ],
    },
  )
}

function createButton(name: string, label: string, onTap: () => void, secondary = false): PiuContainer {
  return new Container(
    { onTap },
    {
      name,
      width: 108,
      height: 30,
      active: true,
      skin: secondary ? secondaryButtonSkin : buttonSkin,
      Behavior: ButtonBehavior,
      contents: [
        new Label(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          string: label,
          style: secondary ? secondaryButtonStyle : buttonStyle,
        }),
      ],
    },
  )
}

function createPlayground(context: MiniAppContext): PiuContainer {
  const choices: PiuContainer[] = []
  const notice = new Label(null, {
    name: 'notice',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    visible: false,
    skin: noticeSkin,
    style: noticeStyle,
    Behavior: NoticeBehavior,
  })
  const help = new Container(null, {
    name: 'help',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    visible: false,
    active: true,
    skin: overlaySkin,
  })

  const select = (value: string) => {
    for (const choice of choices) {
      ;(choice.behavior as ChoiceBehavior).setSelected(choice, choice.name === `choice:${value}`)
    }
    ;(notice.behavior as NoticeBehavior).show(notice, `${value} selected`)
  }

  choices.push(
    createChoice('Ocean', 'Ocean', select),
    createChoice('Forest', 'Forest', select),
    createChoice('Sunset', 'Sunset', select),
  )

  const hideHelp = () => {
    help.visible = false
  }
  const helpClose = createButton('help:close', 'Close', hideHelp, true)
  helpClose.coordinates = { ...helpClose.coordinates, right: 14, bottom: 10 }
  help.add(
    new Container(null, {
      left: 24,
      right: 24,
      top: 36,
      bottom: 36,
      skin: panelSkin,
      contents: [
        new Label(null, { left: 14, right: 14, top: 10, height: 24, string: 'UI Playground', style: titleStyle }),
        new Label(null, {
          left: 14,
          right: 14,
          top: 40,
          height: 36,
          string: 'Choices, overlay, and toast.',
          style: bodyStyle,
        }),
        helpClose,
      ],
    }),
  )

  const root = new Container(null, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    skin: screenSkin,
    contents: [
      new Column(null, {
        left: 12,
        right: 12,
        top: 6,
        contents: [
          new Label(null, { left: 0, right: 0, height: 24, string: 'UI Playground', style: titleStyle }),
          new Container(null, {
            name: 'notice-area',
            left: 0,
            right: 0,
            height: 28,
            contents: [
              new Label(null, {
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                string: 'Choose a theme color',
                style: bodyStyle,
              }),
              notice,
            ],
          }),
          new Content(null, { height: 4 }),
          new Content(null, { name: 'separator', left: 0, right: 0, height: 1, skin: separatorSkin }),
          new Content(null, { height: 5 }),
          ...choices,
          new Content(null, { height: 6 }),
          new Row(null, {
            name: 'actions',
            left: 0,
            right: 0,
            height: 30,
            contents: [
              createButton('help:open', 'About', () => {
                help.visible = true
              }),
              new Content(null, { width: 8 }),
              createButton('app:close', 'Exit', context.close, true),
            ],
          }),
        ],
      }),
      help,
    ],
  })
  ;(choices[0].behavior as ChoiceBehavior).setSelected(choices[0], true)
  return root
}

const sample: MiniAppDefinition = Object.freeze({
  id: 'sample.ui-playground',
  title: 'UI Playground',
  icon: 'play',
  create: createPlayground,
})

export default Object.freeze([sample])
