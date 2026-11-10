#!/usr/bin/env node
import { prepareWebRtcSolution, webRtcSolutionRevision } from './lib/webrtc-solution.mjs'

try {
  console.log(`[stack-chan] WebRTC sources (${webRtcSolutionRevision}): ${prepareWebRtcSolution()}`)
} catch (error) {
  console.error(`[stack-chan] WebRTC setup failed: ${error.message}`)
  process.exit(1)
}
