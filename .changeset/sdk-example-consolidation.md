---
"stack-chan": major
"stackchan-web": major
---

Migrate all 21 remaining API 1 examples to 14 SDK app API 2 packages requiring host API 7. Combine the three dialogue apps into `conversation`, beacon roles into `beacon`, STK/WebSocket cheer-up into `cheerup`, DNS-SD roles into `pose_sharing`, and servo examples into `servo_diagnostics`. Rebuild old archives from their new destinations.

Provide typed, app-owned networking, conversation, streaming audio, SHT3x and servo-maintenance extensions. Reuse the host settings schema, audio reservations, configured servo bus and protocol implementations. Preserve wire formats, provider choices, voice clips and tracking behavior; stop normal servo motion while maintenance runs. Persistent servo changes now require explicit menu actions. Remove the unused Whisper implementation and MOD-specific chat config reader. Move realtime chat configuration into the shared settings UI; transfer old config values manually. Periodic SDK handlers report transient errors and retry at the next interval.

Add per-example setup, editing and recovery instructions, an exhaustive migration map and CI builds for every SDK example and lesson. Physical hardware and beginner acceptance remain separate from automated validation.

Regenerate MediaPipe, MCP and Codex Voice Gallery packages from the canonical SDK examples, retire their checked-in source copies and rebuild release archives with matching metadata.
