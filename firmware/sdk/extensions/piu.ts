import type { Container as PiuContainer } from 'piu/MC'
import 'piu/MC'
import { type AppContext, type AppDefinition, type AppSetup, defineApp } from 'stackchan/app'
import { StackchanError } from 'stackchan/errors'

/** The host owns the viewport and Back action. The app owns everything created inside it. */
export type ScreenContext = Readonly<{ width: number; height: number; app: AppContext; close(): void }>
export type ScreenInstance = Readonly<{ content: PiuContainer; dispose?(): void }>
export type ScreenDefinition = Readonly<{
  id: string
  title: string
  icon?: 'play'
  create(context: ScreenContext): PiuContainer | ScreenInstance
}>
export type PiuAppDefinition = AppDefinition & Readonly<{ screens: readonly ScreenDefinition[] }>

/** Register screens within the same AppSession as setup, inputs and device operations. */
export function definePiuApp(options: { screens: readonly ScreenDefinition[]; setup?: AppSetup }): PiuAppDefinition {
  if (!options || !Array.isArray(options.screens))
    throw new StackchanError('INVALID_ARGUMENT', 'A Piu app needs a list of screens')
  return Object.freeze({
    ...defineApp({ setup: options.setup ?? (() => {}) }),
    screens: Object.freeze([...options.screens]),
  })
}

// Export view constructors only; the host Application and controller are not part of this extension.
const PiuBehavior = Behavior
const PiuColumn = Column
const PiuContent = Content
const PiuContainerConstructor = Container
const PiuLabel = Label
const PiuPort = Port
const PiuRow = Row
const PiuScroller = Scroller
const PiuSkin = Skin
const PiuStyle = Style
const PiuText = Text
const PiuTexture = Texture

export type {
  Container as ViewContainer,
  Content as ViewContent,
  Label as ViewLabel,
  Port as ViewPort,
  Texture as ViewTexture,
} from 'piu/MC'
export {
  PiuBehavior as Behavior,
  PiuColumn as Column,
  PiuContainerConstructor as Container,
  PiuContent as Content,
  PiuLabel as Label,
  PiuPort as Port,
  PiuRow as Row,
  PiuScroller as Scroller,
  PiuSkin as Skin,
  PiuStyle as Style,
  PiuText as Text,
  PiuTexture as Texture,
}
