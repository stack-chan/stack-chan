// SPDX-License-Identifier: Apache-2.0
// Keep screen construction independent of Piu and mc/config initialization.
export function instrumentDisplay(dispatch) {
  return native('xs_avds_probe_display').call(this, dispatch)
}
