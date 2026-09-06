import { defineApp } from 'stackchan'
import { installAppearance } from './appearance'
import { installCompanion } from './companion'
import { installDiagnostics } from './diagnostics'

export default defineApp({
  setup(app) {
    let companion: ReturnType<typeof installCompanion> | undefined
    const appearance = installAppearance(app, () => companion?.stop())
    companion = installCompanion(app, appearance)
    installDiagnostics(app, companion)
  },
})
