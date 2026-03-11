import type { Content as PiuContent, Container as PiuContainer } from 'piu/MC'
import Timeline from 'piu/Timeline'
import { defaultFaceContext, type FaceContext } from 'face-context'

export type DrawerButtonSpec = {
  label: string
  action?: string
  toggleKey?: 'mouth' | 'faceMode'
}

const drawerWidth = 112
const scrollerSkin = new Skin({ fill: '#444' })
const drawerSkin = new Skin({ fill: '#ff0000' })
const drawerButtonSkin = new Skin({ fill: '#fafafa' })
const drawerButtonPressedSkin = new Skin({ fill: '#c0c0c0' })
const drawerButtonStyle = new Style({ font: '16px Open Sans', color: '#222', horizontal: 'left' })
const toggleOnSkin = new Skin({ fill: '#23c552' })
const toggleOffSkin = new Skin({ fill: '#888888' })
const drawerHiddenOffset = -drawerWidth - 1

const DrawerButton = Container.template(($: DrawerButtonSpec) => ({
  left: 0,
  right: 0,
  height: 44,
  active: true,
  skin: drawerButtonSkin,
  contents: [
    $.toggleKey ? new Content(null, { left: 12, width: 16, height: 16, top: 14, skin: toggleOffSkin }) : null,
    new Label(null, {
      left: $.toggleKey ? 36 : 12,
      right: 12,
      top: 0,
      bottom: 0,
      string: $.label ?? 'Button',
      style: drawerButtonStyle,
    }),
  ],
  Behavior: class extends Behavior {
    action?: string
    toggleKey?: DrawerButtonSpec['toggleKey']
    icon?: PiuContent | null
    label?: PiuContent | null
    onCreate(content: PiuContainer, data: DrawerButtonSpec) {
      this.action = data.action
      this.toggleKey = data.toggleKey
      this.icon = this.toggleKey ? (content.first as PiuContent | null) : null
      this.label = this.toggleKey ? (content.last as PiuContent | null) : content.first
    }
    onTouchBegan(content: PiuContainer) {
      content.skin = drawerButtonPressedSkin
    }
    onTouchCancelled(content: PiuContainer) {
      content.skin = drawerButtonSkin
    }
    onTouchEnded(content: PiuContainer) {
      content.skin = drawerButtonSkin
      if (this.action) content.bubble(this.action)
    }
    onFaceContext(_content: PiuContainer, face: FaceContext) {
      if (!this.icon || !this.toggleKey) return
      const active = this.toggleKey === 'mouth' ? !!face.mouth?.open : false
      this.icon.skin = active ? toggleOnSkin : toggleOffSkin
    }
    onFaceMode(_content: PiuContainer, mode: string) {
      if (this.toggleKey !== 'faceMode' || !this.icon || !this.label) return
      const isDog = mode === 'dog'
      this.icon.skin = isDog ? toggleOnSkin : toggleOffSkin
      if (this.label instanceof Label) {
        this.label.string = isDog ? 'Dog Face' : 'Simple Face'
      }
    }
  },
}))

type DrawerDictionary = { buttons?: DrawerButtonSpec[]; topOffset?: number }
type DrawerBehavior = {
  isOpen: boolean
  toggle: (container: PiuContainer) => void
  onFaceContext?: (container: PiuContainer, face: FaceContext) => void
}

type DrawerTemplateCtor = { new (behaviorData?: unknown, dictionary?: DrawerDictionary): PiuContainer }

const DrawerTemplate = Container.template((d: DrawerDictionary) => ({
  name: 'drawer',
  top: 0,
  bottom: 0,
  width: drawerWidth,
  clip: true,
  skin: drawerSkin,
  contents: [
    new Scroller(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      clip: true,
      active: true,
      skin: scrollerSkin,
      contents: [
        new Column(null, {
          left: 0,
          right: 0,
          top: 0,
          contents: d.buttons?.map((b) => new DrawerButton(b)) ?? [],
        }),
      ],
    }),
  ],
  Behavior: class extends Behavior {
    isOpen = false
    timeline: Timeline | null = null
    offset = drawerHiddenOffset
    topOffset = 0

    onCreate(container: PiuContainer, data?: DrawerDictionary) {
      this.topOffset = data?.topOffset ?? 0
      this.applyPosition(container, this.offset)
    }
    onTimeChanged(container: PiuContainer) {
      if (this.timeline) {
        this.timeline.seekTo(container.time)
        this.applyPosition(container, this.offset)
      }
    }
    onFinished(_container: PiuContainer) {
      this.timeline = null
    }
    applyPosition(container: PiuContainer, right: number) {
      container.coordinates = { right, top: this.topOffset, bottom: 0 }
    }
    toggle(container: PiuContainer) {
      const from = this.isOpen ? 0 : drawerHiddenOffset
      const to = this.isOpen ? drawerHiddenOffset : 0
      this.timeline = new Timeline()
      const tl = this.timeline
      tl.on(this, { offset: [from, to] }, 180, Math.quadEaseOut, 0)
      tl.seekTo(0)
      container.duration = tl.duration
      container.time = 0
      container.start()
      this.isOpen = !this.isOpen
    }
  },
})) as unknown as DrawerTemplateCtor

export function createDrawer(buttons?: DrawerButtonSpec[], topOffset?: number): PiuContainer {
  const drawer = new DrawerTemplate({ buttons, topOffset })
  // initialize palette with default face
  const behavior = drawer.behavior as DrawerBehavior | undefined
  behavior?.onFaceContext?.(drawer, defaultFaceContext)
  return drawer
}

export const drawerConstants = { drawerWidth }

export type { DrawerBehavior }
