// @moddable/typings 9.0.0 omits the xs.d.ts entry declared by its package.json.
// Keep the XS extensions used by Stack-chan available to standalone TypeScript checks.

declare function trace(...messages: (string | number | boolean)[]): void

declare class HostBuffer {
  readonly byteLength: number
  private brand: boolean
}

declare function Native(name: string): new (...args: any[]) => any
declare function native(name: string): (...args: any[]) => any

interface ObjectConstructor {
  freeze<T>(object: T, deep?: boolean | number): Readonly<T>
}

interface StringConstructor {
  fromArrayBuffer(buffer: ArrayBufferLike): string
}

interface ArrayBufferConstructor {
  fromString(value: string): ArrayBuffer
}

interface Math {
  idiv(dividend: number, divisor: number): number
}
