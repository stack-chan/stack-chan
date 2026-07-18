import type { Container as PiuContainer, Content as PiuContent, Port as PiuPort } from 'piu/MC'
import { Container, Label, Port } from 'piu/MC'
import { UI, uiStyles } from 'ui-theme'

export type IconName =
  | 'back'
  | 'camera'
  | 'close'
  | 'language'
  | 'menu'
  | 'microphone'
  | 'offline'
  | 'palette'
  | 'play'
  | 'retry'
  | 'scan'
  | 'settings'
  | 'wifi'

export type ActionButtonData = {
  name?: string
  icon: IconName
  label?: string
  onTap?: () => void
  action?: string
  enabled?: boolean
  selected?: boolean
  tone?: 'default' | 'accent' | 'success' | 'danger'
}

type MutableButtonData = ActionButtonData & {
  enabled: boolean
  selected: boolean
}

function actionButtonSkin(data: MutableButtonData, styles: ReturnType<typeof uiStyles>) {
  if (!data.enabled) return styles.disabled
  if (data.selected || data.tone === 'accent') return styles.accent
  if (data.tone === 'success') return styles.success
  if (data.tone === 'danger') return styles.danger
  return styles.surface
}

export type ActionButtonBehavior = {
  setEnabled(container: PiuContainer, enabled: boolean): void
  setSelected(container: PiuContainer, selected: boolean): void
  setLabel(container: PiuContainer, label: string): void
}

export type ScreenHeaderData = {
  title: string
  leading?: 'back' | 'menu'
  trailing?: 'close' | 'language' | 'settings'
  onLeading?: () => void
  onTrailing?: () => void
}

function drawSteps(port: PiuPort, color: string, points: readonly [number, number][]) {
  for (const [x, y] of points) port.fillColor(color, x, y, 3, 3)
}

function drawIcon(port: PiuPort, icon: IconName, color: string) {
  const w = port.width
  const h = port.height
  const cx = Math.floor(w / 2)
  const cy = Math.floor(h / 2)
  switch (icon) {
    case 'menu':
      for (const y of [cy - 7, cy - 1, cy + 5]) port.fillColor(color, cx - 9, y, 18, 3)
      return
    case 'settings':
      for (const [y, knob] of [
        [cy - 7, cx - 4],
        [cy - 1, cx + 5],
        [cy + 5, cx - 1],
      ] as const) {
        port.fillColor(color, cx - 10, y, 20, 2)
        port.fillColor(UI.colors.background, knob - 2, y - 2, 5, 6)
        port.fillColor(color, knob - 1, y - 1, 3, 4)
      }
      return
    case 'language':
      port.fillColor(color, cx - 10, cy - 8, 20, 2)
      port.fillColor(color, cx - 10, cy - 1, 14, 2)
      port.fillColor(color, cx - 10, cy + 6, 9, 2)
      port.fillColor(color, cx + 4, cy - 4, 2, 13)
      port.fillColor(color, cx + 1, cy + 2, 8, 2)
      return
    case 'back':
      port.fillColor(color, cx - 8, cy - 1, 17, 3)
      drawSteps(port, color, [
        [cx - 8, cy - 1],
        [cx - 5, cy - 4],
        [cx - 2, cy - 7],
        [cx - 5, cy + 2],
        [cx - 2, cy + 5],
      ])
      return
    case 'close':
    case 'offline':
      drawSteps(port, color, [
        [cx - 7, cy - 7],
        [cx - 4, cy - 4],
        [cx - 1, cy - 1],
        [cx + 2, cy + 2],
        [cx + 5, cy + 5],
        [cx + 5, cy - 7],
        [cx + 2, cy - 4],
        [cx - 4, cy + 2],
        [cx - 7, cy + 5],
      ])
      return
    case 'play':
      for (let row = -7; row <= 7; row += 2) {
        const width = 9 - Math.abs(row)
        if (width > 0) port.fillColor(color, cx - 4, cy + row, width, 2)
      }
      return
    case 'retry':
      port.fillColor(color, cx - 7, cy - 7, 13, 3)
      port.fillColor(color, cx - 9, cy - 5, 3, 12)
      port.fillColor(color, cx - 6, cy + 5, 13, 3)
      drawSteps(port, color, [
        [cx + 4, cy - 9],
        [cx + 7, cy - 6],
        [cx + 4, cy - 3],
      ])
      return
    case 'scan':
    case 'wifi':
      port.fillColor(color, cx - 2, cy + 6, 4, 4)
      port.fillColor(color, cx - 6, cy + 1, 12, 3)
      port.fillColor(color, cx - 10, cy - 4, 20, 3)
      if (icon === 'scan') port.fillColor(UI.colors.accent, cx + 7, cy - 8, 4, 4)
      return
    case 'camera':
      port.fillColor(color, cx - 10, cy - 6, 20, 14)
      port.fillColor(UI.colors.background, cx - 7, cy - 3, 14, 8)
      port.fillColor(color, cx - 3, cy - 2, 7, 7)
      port.fillColor(color, cx - 5, cy - 9, 10, 4)
      return
    case 'microphone':
      port.fillColor(color, cx - 4, cy - 9, 8, 14)
      port.fillColor(color, cx - 8, cy + 1, 3, 5)
      port.fillColor(color, cx + 5, cy + 1, 3, 5)
      port.fillColor(color, cx - 5, cy + 6, 10, 3)
      port.fillColor(color, cx - 2, cy + 9, 4, 4)
      return
    case 'palette':
      port.fillColor('#ef6262', cx - 8, cy - 7, 7, 7)
      port.fillColor('#42bde8', cx + 1, cy - 7, 7, 7)
      port.fillColor('#42c878', cx - 8, cy + 2, 7, 7)
      port.fillColor('#f0b44c', cx + 1, cy + 2, 7, 7)
  }
}

export const IconView = Port.template((_$: MutableButtonData) => ({
  width: 32,
  height: 32,
  active: false,
  Behavior: class extends Behavior {
    data: MutableButtonData | null = null
    onCreate(_port: PiuPort, data: MutableButtonData) {
      this.data = data
    }
    onDraw(port: PiuPort) {
      if (!this.data) return
      const color = this.data.enabled ? UI.colors.text : UI.colors.textMuted
      drawIcon(port, this.data.icon, color)
    }
  },
}))

export const ActionButton = Container.template(($: ActionButtonData) => {
  const data = $ as MutableButtonData
  data.enabled = $.enabled !== false
  data.selected = $.selected === true
  const styles = uiStyles()
  const iconOnly = !data.label
  const contents: PiuContent[] = [new IconView(data, { left: iconOnly ? 6 : 8, top: 6 })]
  if (data.label) {
    contents.push(
      new Label(null, {
        name: 'label',
        left: 42,
        right: 8,
        top: 0,
        bottom: 0,
        string: data.label,
        style: styles.body,
      }),
    )
  }
  return {
    name: data.name,
    width: iconOnly ? UI.touchTarget : undefined,
    height: UI.touchTarget,
    active: data.enabled,
    skin: actionButtonSkin(data, styles),
    contents,
    Behavior: class extends Behavior implements ActionButtonBehavior {
      data: MutableButtonData | null = null
      moved = false
      startX = 0
      startY = 0
      onCreate(container: PiuContainer, buttonData: MutableButtonData) {
        this.data = buttonData
        this.apply(container)
      }
      onTouchBegan(container: PiuContainer, _id: number, x: number, y: number) {
        if (!this.data?.enabled) return
        this.startX = x
        this.startY = y
        this.moved = false
        container.skin = styles.pressed
      }
      onTouchMoved(container: PiuContainer, _id: number, x: number, y: number) {
        if (Math.abs(x - this.startX) > 8 || Math.abs(y - this.startY) > 8) {
          this.moved = true
          this.apply(container)
        }
      }
      onTouchCancelled(container: PiuContainer) {
        this.moved = false
        this.apply(container)
      }
      onTouchEnded(container: PiuContainer) {
        this.apply(container)
        if (!this.moved && this.data?.enabled) {
          this.data.onTap?.()
          if (this.data.action) container.bubble(this.data.action)
        }
        this.moved = false
      }
      setEnabled(container: PiuContainer, enabled: boolean) {
        if (!this.data) return
        this.data.enabled = enabled
        container.active = enabled
        this.apply(container)
        ;(container.first as (PiuContent & { invalidate?: () => void }) | null)?.invalidate?.()
      }
      setSelected(container: PiuContainer, selected: boolean) {
        if (!this.data) return
        this.data.selected = selected
        this.apply(container)
      }
      setLabel(container: PiuContainer, label: string) {
        if (!this.data) return
        this.data.label = label
        const labelContent = container.content('label') as { string?: string } | null
        if (labelContent) labelContent.string = label
      }
      apply(container: PiuContainer) {
        if (this.data) container.skin = actionButtonSkin(this.data, styles)
      }
    },
  }
})

export const ScreenHeader = Container.template(($: ScreenHeaderData) => {
  const styles = uiStyles()
  const contents: PiuContent[] = [
    new Label(null, {
      left: $.leading ? 48 : 12,
      right: $.trailing ? 48 : 12,
      top: 0,
      bottom: 0,
      string: $.title,
      style: styles.title,
    }),
  ]
  if ($.leading) {
    contents.unshift(
      new ActionButton(
        {
          icon: $.leading,
          onTap: $.onLeading,
        },
        { left: 0, top: -2, width: UI.touchTarget, height: UI.touchTarget },
      ),
    )
  }
  if ($.trailing) {
    contents.push(
      new ActionButton(
        {
          icon: $.trailing,
          onTap: $.onTrailing,
        },
        { right: 0, top: -2, width: UI.touchTarget, height: UI.touchTarget },
      ),
    )
  }
  return {
    left: 0,
    right: 0,
    top: 0,
    height: UI.headerHeight,
    skin: styles.surface,
    contents,
  }
})

export function setActionButtonEnabled(button: PiuContainer | null | undefined, enabled: boolean) {
  ;(button?.behavior as ActionButtonBehavior | undefined)?.setEnabled?.(button as PiuContainer, enabled)
}

export function setActionButtonSelected(button: PiuContainer | null | undefined, selected: boolean) {
  ;(button?.behavior as ActionButtonBehavior | undefined)?.setSelected?.(button as PiuContainer, selected)
}

export function setActionButtonLabel(button: PiuContainer | null | undefined, label: string) {
  ;(button?.behavior as ActionButtonBehavior | undefined)?.setLabel?.(button as PiuContainer, label)
}
