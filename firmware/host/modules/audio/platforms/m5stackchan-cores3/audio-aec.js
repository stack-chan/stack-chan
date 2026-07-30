/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

const runNativeSelfTest = native('xs_audio_aec_self_test')

export function runAecSelfTest() {
  return runNativeSelfTest()
}
