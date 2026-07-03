import {
  Column,
  Container,
  Content,
  type Coordinates,
  Label,
  type Container as PiuContainer,
  type Content as PiuContent,
  Scroller,
  Skin,
  Style,
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
const SCROLL_THRESHOLD = 8

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

class DrawerScrollerBehavior extends Behavior {
  anchor = 0
  startY = 0
  waiting = false
  onTouchBegan(content: PiuContent, _id: number, _x: number, y: number) {
    const scroller = content as unknown as { scroll: { y: number } }
    this.anchor = scroller.scroll.y
    this.startY = y
    this.waiting = true
  }
  onTouchMoved(content: PiuContent, id: number, x: number, y: number, ticks: number) {
    const scroller = content as unknown as {
      scrollTo: (x: number, y: number) => void
      scroll: { y: number }
      captureTouch: (id: number, x: number, y: number, ticks: number) => void
    }
    const delta = y - this.startY
    if (this.waiting) {
      if (Math.abs(delta) < SCROLL_THRESHOLD) return
      this.waiting = false
      scroller.captureTouch(id, x, y, ticks)
    }
    scroller.scrollTo(0, this.anchor - delta)
  }
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
      startX = 0
      startY = 0
      moved = false
      onCreate(content: PiuContainer, data: DrawerButtonSpec) {
        this.action = data.key
        this.icon = data.kind === 'toggle' ? (content.first as PiuContent | null) : null
        this.label = data.kind === 'toggle' ? (content.last as PiuContent | null) : content.first
        if (this.icon && data.active !== undefined) {
          this.icon.skin = data.active ? skins.toggleOnSkin : skins.toggleOffSkin
        }
      }
      onTouchBegan(content: PiuContainer, _id: number, x: number, y: number) {
        this.startX = x
        this.startY = y
        this.moved = false
        content.skin = skins.drawerButtonPressedSkin
      }
      onTouchMoved(content: PiuContainer, _id: number, x: number, y: number) {
        const dx = Math.abs(x - this.startX)
        const dy = Math.abs(y - this.startY)
        if (!this.moved && (dx > 6 || dy > 6)) {
          this.moved = true
          content.skin = skins.drawerButtonSkin
        }
      }
      onTouchCancelled(content: PiuContainer) {
        this.moved = false
        content.skin = skins.drawerButtonSkin
      }
      onTouchEnded(content: PiuContainer) {
        content.skin = skins.drawerButtonSkin
        if (!this.moved && this.action) {
          trace(`[DrawerButton] onTouchEnded action=${this.action}\n`)
          content.bubble(this.action)
        }
        this.moved = false
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
  setButtons?: (container: PiuContainer, buttons: DrawerButtonSpec[]) => boolean
  addButton?: (container: PiuContainer, button: DrawerButtonSpec) => boolean
  removeButton?: (container: PiuContainer, key: string) => boolean
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
    active: true,
    skin: skins.drawerSkin,
    contents: [
      new Scroller(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        clip: true,
        active: true,
        backgroundTouch: true,
        skin: skins.scrollerSkin,
        Behavior: DrawerScrollerBehavior,
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
      coordinates = { right: drawerHiddenOffset, width: drawerWidth, top: 0, bottom: 0 } as unknown as Coordinates
      isOpen = false
      buttonList: PiuContainer | null = null
      timeline: Timeline | null = null
      offset = drawerHiddenOffset

      onCreate(container: PiuContainer, _data?: DrawerDictionary) {
        container.interval = 16
        this.buttonList = this.findButtonList(container)
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
        this.coordinates.right = right
        container.coordinates = this.coordinates
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
      setButtons(container: PiuContainer, buttons: DrawerButtonSpec[]) {
        const list = this.getButtonList(container)
        if (!list) return false
        list.empty()
        for (const button of buttons) {
          list.add(new DrawerButton(button))
        }
        return true
      }
      addButton(container: PiuContainer, button: DrawerButtonSpec) {
        const list = this.getButtonList(container)
        if (!list) return false
        const existing = this.findButtonInList(list, button.key)
        const next = existing?.next as PiuContent | null | undefined
        if (existing) {
          list.remove(existing)
        }
        const node = new DrawerButton(button)
        if (next) list.insert(node, next)
        else list.add(node)
        return true
      }
      removeButton(container: PiuContainer, key: string) {
        const list = this.getButtonList(container)
        if (!list) return false
        const button = this.findButtonInList(list, key)
        if (!button) return false
        list.remove(button)
        return true
      }
      setButtonState(container: PiuContainer, key: string, active: boolean) {
        const list = this.getButtonList(container)
        const button = list ? this.findButtonInList(list, key) : null
        if (!button) return false
        const behavior = button.behavior as { setActive?: (content: PiuContainer, state: boolean) => void } | undefined
        behavior?.setActive?.(button, active)
        return true
      }
      getButtonList(container: PiuContainer): PiuContainer | null {
        if (this.buttonList) return this.buttonList
        this.buttonList = this.findButtonList(container)
        return this.buttonList
      }
      findButtonList(container: PiuContainer): PiuContainer | null {
        const scroller = container.first as PiuContainer | null
        return (scroller?.first as PiuContainer | null) ?? null
      }
      findButtonInList(list: PiuContainer, key: string): PiuContainer | null {
        let current: PiuContent | null = list.first as PiuContent | null
        while (current) {
          if ((current as PiuContainer).name === key) {
            return current as PiuContainer
          }
          current = current.next as PiuContent | null
        }
        return null
      }
    },
  }
}) as unknown as DrawerTemplateCtor

export const drawerConstants = { drawerWidth }

export type { DrawerBehavior }
