import type { Application } from 'piu/MC'

declare global {
  // The Moddable runtime exposes the current Application on the global object.
  // This declaration allows accessing globalThis.application with proper typing.
  var application: Application
}
