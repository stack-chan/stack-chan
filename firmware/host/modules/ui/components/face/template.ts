import type { Shape as PiuShape, ShapeDictionary } from 'piu/shape'

export type ShapeTemplate<TData> = {
  new (behaviorData?: TData, dictionary?: ShapeDictionary): PiuShape
}

export function defineShapeTemplate<TData>(factory: (data: TData) => ShapeDictionary): ShapeTemplate<TData> {
  return Shape.template(factory as unknown as (arg: object) => ShapeDictionary) as unknown as ShapeTemplate<TData>
}
