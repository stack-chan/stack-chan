export const ScreenKind = Object.freeze({
  Face: 0,
  MiniAppLauncher: 1,
  MiniAppRunning: 2,
  SystemView: 3,
} as const)

export type ScreenKind = (typeof ScreenKind)[keyof typeof ScreenKind]

export type ScreenState = Readonly<{
  kind: ScreenKind
  appId: string | null
  title: string | null
  sessionId: number
}>

export type ScreenBackOutcome = Readonly<
  { action: 'none' } | { action: 'exit-mini-app'; appId: string; sessionId: number } | { action: 'return-to-face' }
>

export type ScreenChangeListener = (next: ScreenState, previous: ScreenState) => void

const DEFAULT_LAUNCHER_TITLE = 'ミニアプリ'

const INITIAL_SCREEN_STATE: ScreenState = Object.freeze({
  kind: ScreenKind.Face,
  appId: null,
  title: null,
  sessionId: 0,
})

export class ScreenCoordinator {
  #kind: ScreenKind = ScreenKind.Face
  #appId: string | null = null
  #title: string | null = null
  #sessionId = 0
  #nextSessionId = 0
  #state: ScreenState = INITIAL_SCREEN_STATE
  #listeners = new Set<ScreenChangeListener>()

  get kind(): ScreenKind {
    return this.#kind
  }

  get appId(): string | null {
    return this.#appId
  }

  get title(): string | null {
    return this.#title
  }

  get sessionId(): number {
    return this.#sessionId
  }

  get isFaceForeground(): boolean {
    return this.#kind === ScreenKind.Face
  }

  get state(): ScreenState {
    return this.#state
  }

  openMiniAppLauncher(title = DEFAULT_LAUNCHER_TITLE): boolean {
    if (this.#kind === ScreenKind.MiniAppLauncher && this.#title === title) return false
    this.#transition(ScreenKind.MiniAppLauncher, null, title, 0)
    return true
  }

  enterMiniApp(appId: string, title: string): number {
    this.#nextSessionId += 1
    const sessionId = this.#nextSessionId
    this.#transition(ScreenKind.MiniAppRunning, appId, title, sessionId)
    return sessionId
  }

  exitMiniApp(expectedSessionId?: number): boolean {
    if (this.#kind !== ScreenKind.MiniAppRunning) return false
    if (expectedSessionId !== undefined && this.#sessionId !== expectedSessionId) return false
    this.#transition(ScreenKind.Face, null, null, 0)
    return true
  }

  enterSystemView(title: string | null = null): boolean {
    if (this.#kind === ScreenKind.SystemView && this.#title === title) return false
    this.#transition(ScreenKind.SystemView, null, title, 0)
    return true
  }

  returnToFace(): boolean {
    if (this.#kind === ScreenKind.Face) return false
    this.#transition(ScreenKind.Face, null, null, 0)
    return true
  }

  handleBackAction(): ScreenBackOutcome {
    if (this.#kind === ScreenKind.MiniAppRunning) {
      const appId = this.#appId ?? ''
      const sessionId = this.#sessionId
      this.#transition(ScreenKind.Face, null, null, 0)
      return Object.freeze({ action: 'exit-mini-app', appId, sessionId })
    }
    if (this.#kind === ScreenKind.MiniAppLauncher || this.#kind === ScreenKind.SystemView) {
      this.#transition(ScreenKind.Face, null, null, 0)
      return Object.freeze({ action: 'return-to-face' })
    }
    return Object.freeze({ action: 'none' })
  }

  subscribe(listener: ScreenChangeListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #transition(kind: ScreenKind, appId: string | null, title: string | null, sessionId: number): void {
    const previous = this.#state
    this.#kind = kind
    this.#appId = appId
    this.#title = title
    this.#sessionId = sessionId
    const next: ScreenState = Object.freeze({ kind, appId, title, sessionId })
    this.#state = next
    for (const listener of this.#listeners) {
      listener(next, previous)
    }
  }
}
