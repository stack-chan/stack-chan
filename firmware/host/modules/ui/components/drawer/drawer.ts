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
import { type IconName, IconView } from 'ui-controls'
import { UI } from 'ui-theme'

export type { IconName } from 'ui-controls'

export type DrawerOption = {
  value: string
  label: string
  color?: string
}

export type DrawerButtonViewSpec = {
  key: string
  label: string
  kind?: 'action' | 'choice' | 'swatch' | 'toggle'
  active?: boolean
  value?: string
  options?: DrawerOption[]
  icon?: IconName
}

const drawerWidth = 160
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
    scrollerSkin: new Skin({ fill: UI.colors.surface }),
    drawerSkin: new Skin({ fill: UI.colors.surface }),
    drawerButtonSkin: new Skin({ fill: UI.colors.surface }),
    drawerButtonPressedSkin: new Skin({ fill: UI.colors.surfacePressed }),
    drawerButtonStyle: new Style({ font: 'k8x12-12', color: UI.colors.text, horizontal: 'left' }),
    toggleOnSkin: new Skin({ fill: UI.colors.success }),
    toggleOffSkin: new Skin({ fill: UI.colors.disabled }),
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

const DrawerButton = Container.template(($: DrawerButtonViewSpec) => {
  const skins = getDrawerSkins()
  const isToggle = $.kind === 'toggle'
  const isChoice = $.kind === 'choice' || $.kind === 'swatch'
  const contents: PiuContent[] = []
  if (isToggle) {
    contents.push(new Content(null, { left: 12, width: 16, height: 16, top: 14, skin: skins.toggleOffSkin }))
  }
  if (!isToggle && !isChoice && $.icon) {
    contents.push(
      new IconView({ icon: $.icon, enabled: true, selected: false }, { left: 4, top: 6, width: 32, height: 32 }),
    )
  }
  contents.push(
    new Label(null, {
      left: isToggle || (!isChoice && $.icon) ? 36 : 12,
      right: 12,
      top: isChoice ? 4 : 0,
      height: isChoice ? 20 : undefined,
      bottom: isChoice ? undefined : 0,
      string: $.label ?? 'Button',
      style: skins.drawerButtonStyle,
    }),
  )
  if (isChoice) {
    const selected = $.options?.find((option) => option.value === $.value)
    if ($.kind === 'swatch' && selected?.color) {
      contents.push(
        new Content(null, { left: 12, top: 27, width: 16, height: 16, skin: new Skin({ fill: selected.color }) }),
      )
    }
    contents.push(
      new Label(null, {
        name: 'value',
        left: $.kind === 'swatch' ? 36 : 20,
        right: 12,
        top: 24,
        height: 24,
        string: `${selected?.label ?? ''}  >`,
        style: skins.drawerButtonStyle,
      }),
    )
  }
  return {
    name: $.key,
    left: 0,
    right: 0,
    height: isChoice ? 52 : 44,
    active: true,
    skin: skins.drawerButtonSkin,
    contents,
    Behavior: class extends Behavior {
      action?: string
      kind?: DrawerButtonViewSpec['kind']
      icon?: PiuContent | null
      label?: PiuContent | null
      startX = 0
      startY = 0
      moved = false
      onCreate(content: PiuContainer, data: DrawerButtonViewSpec) {
        this.action = data.key
        this.kind = data.kind
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
          if (this.kind === 'choice' || this.kind === 'swatch') {
            content.bubble('onDrawerChoiceOpen', this.action)
          } else {
            content.bubble(this.action)
          }
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

type DrawerChoiceData = {
  key: string
  option: DrawerOption
  selected: boolean
}

const DrawerChoice = Container.template(($: DrawerChoiceData) => {
  const skins = getDrawerSkins()
  const contents: PiuContent[] = []
  if ($.option.color) {
    contents.push(
      new Content(null, { left: 12, top: 14, width: 16, height: 16, skin: new Skin({ fill: $.option.color }) }),
    )
  }
  contents.push(
    new Label(null, {
      left: $.option.color ? 38 : 12,
      right: 12,
      top: 0,
      bottom: 0,
      string: `${$.selected ? '> ' : ''}${$.option.label}`,
      style: skins.drawerButtonStyle,
    }),
  )
  return {
    left: 0,
    right: 0,
    height: 44,
    active: true,
    skin: $.selected ? skins.drawerButtonPressedSkin : skins.drawerButtonSkin,
    contents,
    Behavior: class extends Behavior {
      startX = 0
      startY = 0
      moved = false
      onTouchBegan(_content: PiuContainer, _id: number, x: number, y: number) {
        this.startX = x
        this.startY = y
        this.moved = false
      }
      onTouchMoved(_content: PiuContainer, _id: number, x: number, y: number) {
        if (Math.abs(x - this.startX) > 6 || Math.abs(y - this.startY) > 6) this.moved = true
      }
      onTouchCancelled() {
        this.moved = false
      }
      onTouchEnded(content: PiuContainer) {
        if (!this.moved) content.bubble('onDrawerChoiceSelected', { key: $.key, value: $.option.value })
        this.moved = false
      }
    },
  }
})

const DrawerChoiceBack = Container.template(() => {
  const skins = getDrawerSkins()
  return {
    left: 0,
    right: 0,
    height: 44,
    active: true,
    skin: skins.drawerButtonSkin,
    contents: [
      new Label(null, {
        left: 12,
        right: 12,
        top: 0,
        bottom: 0,
        string: '< 戻る',
        style: skins.drawerButtonStyle,
      }),
    ],
    Behavior: class extends Behavior {
      startX = 0
      startY = 0
      moved = false
      onTouchBegan(_content: PiuContainer, _id: number, x: number, y: number) {
        this.startX = x
        this.startY = y
        this.moved = false
      }
      onTouchMoved(_content: PiuContainer, _id: number, x: number, y: number) {
        if (Math.abs(x - this.startX) > 6 || Math.abs(y - this.startY) > 6) this.moved = true
      }
      onTouchCancelled() {
        this.moved = false
      }
      onTouchEnded(content: PiuContainer) {
        if (!this.moved) content.bubble('onDrawerChoiceBack')
        this.moved = false
      }
    },
  }
})

type DrawerDictionary = { buttons?: DrawerButtonViewSpec[] }
type DrawerBehavior = {
  isOpen: boolean
  toggle: (container: PiuContainer) => void
  setOpen: (container: PiuContainer, open: boolean) => void
  setButtons?: (container: PiuContainer, buttons: DrawerButtonViewSpec[]) => boolean
  addButton?: (container: PiuContainer, button: DrawerButtonViewSpec) => boolean
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
      buttons: DrawerButtonViewSpec[] = []

      onCreate(container: PiuContainer, data?: DrawerDictionary) {
        container.interval = 16
        this.buttons = [...(data?.buttons ?? [])]
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
      setButtons(container: PiuContainer, buttons: DrawerButtonViewSpec[]) {
        const list = this.getButtonList(container)
        if (!list) return false
        this.buttons = [...buttons]
        this.renderButtons(list)
        return true
      }
      addButton(container: PiuContainer, button: DrawerButtonViewSpec) {
        const list = this.getButtonList(container)
        if (!list) return false
        const buttonIndex = this.buttons.findIndex((item) => item.key === button.key)
        if (buttonIndex >= 0) this.buttons[buttonIndex] = button
        else this.buttons.push(button)
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
        this.buttons = this.buttons.filter((item) => item.key !== key)
        return true
      }
      onDrawerChoiceOpen(container: PiuContainer, key: string) {
        const list = this.getButtonList(container)
        const button = this.buttons.find((item) => item.key === key)
        if (!list || !button?.options) return true
        list.empty()
        list.add(new DrawerChoiceBack())
        for (const option of button.options) {
          list.add(new DrawerChoice({ key, option, selected: option.value === button.value }))
        }
        return true
      }
      onDrawerChoiceBack(container: PiuContainer) {
        const list = this.getButtonList(container)
        if (list) this.renderButtons(list)
        return true
      }
      onDrawerChoiceSelected(container: PiuContainer, selection: { key: string; value: string }) {
        const button = this.buttons.find((item) => item.key === selection.key)
        if (button) button.value = selection.value
        const list = this.getButtonList(container)
        if (list) this.renderButtons(list)
        container.bubble(selection.key, selection.value)
        return true
      }
      renderButtons(list: PiuContainer) {
        list.empty()
        for (const button of this.buttons) list.add(new DrawerButton(button))
      }
      setButtonState(container: PiuContainer, key: string, active: boolean) {
        const list = this.getButtonList(container)
        const button = list ? this.findButtonInList(list, key) : null
        if (!button) return false
        const spec = this.buttons.find((item) => item.key === key)
        if (spec) spec.active = active
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
