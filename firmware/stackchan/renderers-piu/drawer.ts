import {
  Column,
  Container,
  Content,
  Label,
  Scroller,
  Skin,
  Style,
  type Coordinates,
  type Container as PiuContainer,
  type Content as PiuContent,
} from 'piu/MC'
import Timeline from 'piu/Timeline'

export type DrawerButtonSpec = {
  key: string
  label: string
  kind?: 'action' | 'toggle'
  active?: boolean
}

const drawerWidth = 112
const drawerHiddenOffset = -drawerWidth - 1

type DrawerSkins = {
  scrollerSkin: Skin
  drawerSkin: Skin
  drawerButtonSkin: Skin
  drawerButtonPressedSkin: Skin
  drawerButtonStyle: Style
  toggleOnSkin: Skin
  toggleOffSkin: Skin
}

let cachedSkins: DrawerSkins | null = null

function getDrawerSkins(): DrawerSkins {
  if (cachedSkins) return cachedSkins
  cachedSkins = {
    scrollerSkin: new Skin({ fill: '#444' }),
    drawerSkin: new Skin({ fill: '#ff0000' }),
    drawerButtonSkin: new Skin({ fill: '#fafafa' }),
    drawerButtonPressedSkin: new Skin({ fill: '#c0c0c0' }),
    drawerButtonStyle: new Style({ font: '16px Open Sans', color: '#222', horizontal: 'left' }),
    toggleOnSkin: new Skin({ fill: '#23c552' }),
    toggleOffSkin: new Skin({ fill: '#888888' }),
  }
  return cachedSkins
}

const DrawerButton = Container.template(($: DrawerButtonSpec) => {
  const skins = getDrawerSkins()
  const isToggle = $.kind === 'toggle'
  const contents: PiuContent[] = []
  if (isToggle) {
    contents.push(new Content(null, { left: 12, width: 16, height: 16, top: 14, skin: skins.toggleOffSkin }))
  }
  contents.push(
    new Label(null, {
      left: isToggle ? 36 : 12,
      right: 12,
      top: 0,
      bottom: 0,
      string: $.label ?? 'Button',
      style: skins.drawerButtonStyle,
    }),
  )
  return {
    name: $.key,
    left: 0,
    right: 0,
    height: 44,
    active: true,
    skin: skins.drawerButtonSkin,
    contents,
    Behavior: class extends Behavior {
      action?: string
      icon?: PiuContent | null
      label?: PiuContent | null
      onCreate(content: PiuContainer, data: DrawerButtonSpec) {
        this.action = data.key
        this.icon = data.kind === 'toggle' ? (content.first as PiuContent | null) : null
        this.label = data.kind === 'toggle' ? (content.last as PiuContent | null) : content.first
        if (this.icon && data.active !== undefined) {
          this.icon.skin = data.active ? skins.toggleOnSkin : skins.toggleOffSkin
        }
      }
      onTouchBegan(content: PiuContainer) {
        content.skin = skins.drawerButtonPressedSkin
      }
      onTouchCancelled(content: PiuContainer) {
        content.skin = skins.drawerButtonSkin
      }
      onTouchEnded(content: PiuContainer) {
        content.skin = skins.drawerButtonSkin
        if (this.action) {
          trace(`[DrawerButton] onTouchEnded action=${this.action}\n`)
          content.bubble(this.action)
        }
      }
      setActive(_content: PiuContainer, active: boolean) {
        if (!this.icon) return
        this.icon.skin = active ? skins.toggleOnSkin : skins.toggleOffSkin
      }
    },
  }
})

type DrawerDictionary = { buttons?: DrawerButtonSpec[] }
type DrawerBehavior = {
  isOpen: boolean
  toggle: (container: PiuContainer) => void
  setOpen: (container: PiuContainer, open: boolean) => void
  setButtonState?: (container: PiuContainer, key: string, active: boolean) => boolean
}

type DrawerTemplateCtor = { new (behaviorData?: unknown, dictionary?: DrawerDictionary): PiuContainer }

export const Drawer: DrawerTemplateCtor = Container.template((d: DrawerDictionary) => {
  const skins = getDrawerSkins()
  return {
    name: 'drawer',
    top: 0,
    bottom: 0,
    width: drawerWidth,
    clip: true,
    skin: skins.drawerSkin,
    contents: [
      new Scroller(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        clip: true,
        active: true,
        skin: skins.scrollerSkin,
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

      onCreate(container: PiuContainer, data?: DrawerDictionary) {
        container.interval = 16
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
        container.coordinates = { right, width: drawerWidth, top: 0, bottom: 0 } as unknown as Coordinates
      }
      startAnimation(container: PiuContainer, to: number) {
        const from = this.offset
        if (from === to && !this.timeline) {
          this.applyPosition(container, this.offset)
          return
        }
        container.stop?.()
        this.timeline = null
        const tl = new Timeline()
        this.timeline = tl
        tl.on(this, { offset: [from, to] }, 180, Math.quadEaseOut, 0)
        tl.seekTo(0)
        container.duration = tl.duration
        container.time = 0
        container.start()
      }
      setOpen(container: PiuContainer, open: boolean) {
        trace(`[Drawer] setOpen ${open}\n`)
        if (this.isOpen === open && !this.timeline) return
        this.isOpen = open
        const to = this.isOpen ? 0 : drawerHiddenOffset
        this.startAnimation(container, to)
      }
      toggle(container: PiuContainer) {
        this.setOpen(container, !this.isOpen)
      }
      setButtonState(container: PiuContainer, key: string, active: boolean) {
        const button = this.findButton(container, key)
        if (!button) return false
        const behavior = button.behavior as { setActive?: (content: PiuContainer, state: boolean) => void } | undefined
        behavior?.setActive?.(button, active)
        return true
      }
      findButton(container: PiuContainer, key: string): PiuContainer | null {
        const stack: PiuContent[] = []
        let current: PiuContent | null = container.first as PiuContent | null
        while (current) {
          stack.push(current)
          current = current.next as PiuContent | null
        }
        while (stack.length > 0) {
          const node = stack.pop() as PiuContent
          if ((node as PiuContainer).name === key) {
            return node as PiuContainer
          }
          const first = (node as PiuContainer).first as PiuContent | null
          if (first) {
            let child: PiuContent | null = first
            while (child) {
              stack.push(child)
              child = child.next as PiuContent | null
            }
          }
        }
        return null
      }
    },
  }
}) as unknown as DrawerTemplateCtor

export const drawerConstants = { drawerWidth }

export type { DrawerBehavior }
