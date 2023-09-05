declare module 'fetch' {
  export function fetch(...args: any): any
  export class Headers {
    constructor(params: Array<[string, string]>)
  }
}
