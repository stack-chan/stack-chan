import { createResampledOutput } from 'muse-resampled-output'
import * as output from 'muse-stopwatch-output'
import resample from 'pcm-resampler'

const adapted = createResampledOutput({ ...output, resample })
export const minimumOutputBytes = adapted.minimumOutputBytes
export const openOutput = adapted.openOutput
