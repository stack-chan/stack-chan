/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export function amplifierVolumeByte(attenuationDb) {
  const coarseSteps = Math.min(15, Math.floor(attenuationDb / 6))
  const fineSteps = Math.round((attenuationDb - coarseSteps * 6) * 2)
  return (coarseSteps << 4) | fineSteps
}

export function amplifierVolumeRegister(attenuationDb) {
  return (amplifierVolumeByte(attenuationDb) << 8) | 0x64
}

export function buildProbe(sampleCount, peakLevel) {
  const probe = new Int16Array(sampleCount)
  let random = 0x6d2b79f5
  let lowPass = 0
  let baseline = 0
  let peak = 1

  for (let index = 0; index < probe.length; index += 1) {
    random ^= random << 13
    random ^= random >>> 17
    random ^= random << 5
    const white = random >> 16
    lowPass += (white - lowPass) >> 1
    baseline += (lowPass - baseline) >> 5
    const shaped = lowPass - baseline
    probe[index] = shaped
    const magnitude = Math.abs(shaped)
    if (peak < magnitude) peak = magnitude
  }

  const scale = peakLevel / peak
  for (let index = 0; index < probe.length; index += 1) probe[index] = Math.round(probe[index] * scale)
  return probe
}
