import type { RobotUI, TTS } from 'capabilities'
import type { MotionDriver } from 'motion-controller'

export type MotionDriverFactory = (param: unknown) => MotionDriver
export type TTSFactory = (param: unknown) => TTS
export type UIFactory = (param: unknown) => RobotUI

type FactoryKind = 'motion driver' | 'TTS engine' | 'UI controller'

const motionDrivers = new Map<string, MotionDriverFactory>()
const ttsEngines = new Map<string, TTSFactory>()
const uiControllers = new Map<string, UIFactory>()

function registerFactory<T>(kind: FactoryKind, registry: Map<string, T>, type: string, factory: T): void {
  if (registry.has(type)) {
    throw new Error(`${kind} type "${type}" is already registered`)
  }
  registry.set(type, factory)
}

export function registerMotionDriverFactory(type: string, factory: MotionDriverFactory): void {
  registerFactory('motion driver', motionDrivers, type, factory)
}

export function registerTTSFactory(type: string, factory: TTSFactory): void {
  registerFactory('TTS engine', ttsEngines, type, factory)
}

export function registerUIFactory(type: string, factory: UIFactory): void {
  registerFactory('UI controller', uiControllers, type, factory)
}

export function getMotionDriverFactory(type: string): MotionDriverFactory | undefined {
  return motionDrivers.get(type)
}

export function getTTSFactory(type: string): TTSFactory | undefined {
  return ttsEngines.get(type)
}

export function getUIFactory(type: string): UIFactory | undefined {
  return uiControllers.get(type)
}

export function listMotionDriverFactoryTypes(): string[] {
  return [...motionDrivers.keys()]
}

export function listTTSFactoryTypes(): string[] {
  return [...ttsEngines.keys()]
}

export function listUIFactoryTypes(): string[] {
  return [...uiControllers.keys()]
}

export function clearFactoryRegistryForTest(): void {
  motionDrivers.clear()
  ttsEngines.clear()
  uiControllers.clear()
}
