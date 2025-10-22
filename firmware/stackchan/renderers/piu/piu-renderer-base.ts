import { type FaceContext, type Emotion, defaultFaceContext, createFaceContext, copyFaceContext } from 'renderer-base'

export type FaceBehavior<T = unknown> = {
  modify(faceContext: FaceContext, tick: number, arg?: T): void
}

export type FaceBehaviorFactory<T, V = unknown> = (param: T) => FaceBehavior<V>

const INTERVAL = 1000 / 10

export class PiuRendererBase extends Container {
  private currentContext: FaceContext
  private lastContext: FaceContext
  private readonlyContext: Readonly<FaceContext>
  private faceBehaviors: FaceBehavior[]

  constructor(behaviorData: unknown, dictionary: Record<string, unknown>) {
    super(behaviorData, dictionary)
    this.currentContext = createFaceContext()
    this.lastContext = createFaceContext()
    this.readonlyContext = this.currentContext
    this.faceBehaviors = []
  }

  addBehavior(behavior: FaceBehavior): void {
    this.faceBehaviors.push(behavior)
  }

  removeBehavior(behavior: FaceBehavior): void {
    const index = this.faceBehaviors.indexOf(behavior)
    if (index !== -1) {
      this.faceBehaviors.splice(index, 1)
    }
  }

  update(faceContext: Readonly<FaceContext> = defaultFaceContext, interval = INTERVAL): void {
    // Copy input context to current context
    copyFaceContext(faceContext, this.currentContext)

    // Apply all face behaviors
    for (const behavior of this.faceBehaviors) {
      behavior.modify(this.currentContext, interval)
    }

    // Check if context has changed
    const hasChanged = !this.deepEqual(this.currentContext, this.lastContext)

    if (hasChanged) {
      // Update readonly reference
      this.readonlyContext = this.currentContext

      // Distribute context to all child components
      this.distribute('onFaceContextChanged', this.readonlyContext)

      // Swap contexts
      ;[this.currentContext, this.lastContext] = [this.lastContext, this.currentContext]
    }
  }

  getFaceContext(): Readonly<FaceContext> {
    return this.readonlyContext
  }

  private deepEqual(a: FaceContext, b: FaceContext): boolean {
    // Simple deep equality check for FaceContext
    return (
      a.mouth.open === b.mouth.open &&
      a.eyes.left.open === b.eyes.left.open &&
      a.eyes.left.gazeX === b.eyes.left.gazeX &&
      a.eyes.left.gazeY === b.eyes.left.gazeY &&
      a.eyes.right.open === b.eyes.right.open &&
      a.eyes.right.gazeX === b.eyes.right.gazeX &&
      a.eyes.right.gazeY === b.eyes.right.gazeY &&
      a.breath === b.breath &&
      a.emotion === b.emotion &&
      this.arrayEqual(a.theme.primary, b.theme.primary) &&
      this.arrayEqual(a.theme.secondary, b.theme.secondary)
    )
  }

  private arrayEqual(a: number[], b: number[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i])
  }
}

// Export types for use in other files
export { type FaceContext, type Emotion, defaultFaceContext, createFaceContext }
