/// <reference path="./types.d.ts" />

import { defineMod } from 'mod-kit'
import { createWebRadioDeps } from 'web-radio-adapters'
import { STATIONS } from 'web-radio-config'
import { createRadioApp } from 'web-radio-workflow'

export const { onContextCreated, onClose } = defineMod({
  setup(context, _option, scope) {
    const app = createRadioApp(createWebRadioDeps(context, STATIONS))
    scope.own(() => app.stop())
    void app.start().catch(() => {})
  },
})
