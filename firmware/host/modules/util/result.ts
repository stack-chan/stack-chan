/**
 * A type that represents a value that may or may not be present.
 *
 * @typeParam T - the type of the value that may or may not be present.
 */
export type Maybe<T> =
  | {
      success: true
      value: T
    }
  | {
      success: false
      /**
       * The reason why the value is not present, if available.
       */
      reason?: string
    }
