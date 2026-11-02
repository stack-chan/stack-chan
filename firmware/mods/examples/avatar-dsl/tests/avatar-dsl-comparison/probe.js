// SPDX-License-Identifier: Apache-2.0
// Diagnostic host only. Both backends use the same outer Piu/Poco timing scope.
import { Container, Template } from 'piu/MC'

export const RasterProbe = Template(
  Object.freeze({
    __proto__: Container.prototype,
    _create($, dictionary) {
      native('xs_avds_probe_create').call(this, $, dictionary)
    },
    get stats() {
      return native('xs_avds_probe_stats').call(this)
    },
  }),
)

export function microseconds() {
  return native('xs_avds_probe_us').call(this)
}
export function instrumentDisplay(dispatch) {
  return native('xs_avds_probe_display').call(this, dispatch)
}
export function displayStats() {
  return native('xs_avds_probe_display_stats').call(this)
}
