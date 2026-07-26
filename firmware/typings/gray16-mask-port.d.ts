declare module 'parts/gray16-mask-port' {
  import type { Gray16Mask } from 'parts/gray16-mask'
  import type { ContentDictionary, Port } from 'piu/MC'

  export interface Gray16MaskPort extends Port {
    drawGray(mask: Gray16Mask, color: number): void
  }

  interface Gray16MaskPortConstructor {
    new (behaviorData?: unknown, dictionary?: ContentDictionary): Gray16MaskPort
    (behaviorData?: unknown, dictionary?: ContentDictionary): Gray16MaskPort
    template<T>(this: T, factory: (data: unknown) => ContentDictionary): T
  }

  const Gray16MaskPort: Gray16MaskPortConstructor
  export default Gray16MaskPort
}
