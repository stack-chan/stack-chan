// SPDX-License-Identifier: Apache-2.0
import { instrumentDisplay } from 'avatar-dsl/display-probe'
import Screen from 'm5stackchan-screen'

export default class ProfiledScreen extends Screen {
  constructor(options) {
    super(options)
    this.dispatchProbe = instrumentDisplay(super.c_dispatch)
  }
  get c_dispatch() {
    return this.dispatchProbe
  }
}
