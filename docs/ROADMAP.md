# Stack-chan Development Roadmap

Last updated: 2026-03-27

## Purpose

This document defines an execution-oriented roadmap for Stack-chan.

The core goal is to reduce setup and development overhead without losing the qualities that make Stack-chan valuable today:

- Fast to iterate
- Hackable by default
- Extensible across firmware, mods, AI, and tooling

## Planning Principles

- Browser-first, not browser-only. Advanced local development remains available, but common workflows should not require Moddable or ESP-IDF setup.
- Standardize interfaces before expanding features. Mod format, AI pipeline, logs, and event contracts should be stabilized before multi-vendor or multi-agent expansion.
- Preserve the host/MOD architecture. The existing fast MOD iteration loop is a strategic advantage and should remain central.
- Stabilize AI behavior before adding advanced AI capabilities. Choppy TTS and opaque runtime behavior should be solved before vision, wake word, or swarming.
- Keep beginner and expert workflows aligned. Visual tools and educational flows should converge on the same runtime and packaging model used by advanced mod development.

## Current Baseline

As of 2026-03-27, the repository already provides several strong building blocks:

- Host and MOD are separated, enabling fast MOD-only deployment.
- Browser-based firmware flashing already exists.
- Browser-based preference editing over BLE already exists.
- TTS support and AI-related demos exist, but setup still depends on external services and manual configuration.
- Local development setup is still heavy for many users, especially outside an established Moddable environment.

This means the roadmap should focus on turning existing pieces into a coherent platform, not replacing them.

## Strategic Priorities

1. Define the minimum 2026 architectural refactor needed to support the next 5 years.
2. Make the standard development loop work from the browser for the majority of users.
3. Stabilize AI Stack-chan by making the audio pipeline observable and debuggable.
4. Introduce a pluggable AI pipeline so STT, LLM, and TTS vendors can be swapped without rewriting applications.
5. Expand the ecosystem with asset tooling and educational entry points.
6. Pursue advanced capabilities such as vision, wake word, and swarming only after the core platform is stable.

## Roadmap

| Phase | Target period | Goal | Main deliverables | Exit criteria |
| --- | --- | --- | --- | --- |
| Phase 0 | April 2026 to May 2026 | Align architecture and measure the current system | Platform position paper, mod packaging decision, AI pipeline contract draft, structured log schema, build pipeline foundation, release flow definition, AI-driven development conventions | Team agrees on platform boundaries, core artifacts can be built and released through an agreed flow, AI agents operate within defined instructions and validation gates, and baseline measurements for setup effort and TTS quality are captured |
| Phase 1 | June 2026 to August 2026 | Ship a browser-first development MVP | Improved web flashing flow, browser-based mod editing/upload path, security and sandbox policy, machine-readable test/log output, browser simulator feasibility prototype | A supported user can flash firmware and iterate on a sample mod without local SDK installation |
| Phase 2 | August 2026 to October 2026 | Stabilize AI Stack-chan in production-like conditions | Runtime instrumentation for audio, root-cause analysis of choppy TTS, buffer and scheduler fixes, developer-friendly API key setup flow | TTS issues can be reproduced, measured, and improved with clear diagnostics and agreed thresholds |
| Phase 3 | October 2026 to December 2026 | Standardize the pluggable AI runtime | ChatAudioIO-compatible interface, STT/LLM/TTS adapter layer, latency budget per stage, local-vs-cloud reference architecture, compatibility docs | Applications can switch supported AI providers mostly by configuration rather than application rewrites |
| Phase 4 | January 2027 to March 2027 | Expand creation tools for broader adoption | Web face editor beta, asset format standardization, runtime vs build-time asset loading guidance, visual programming prototype | A beginner can create a face or simple behavior and deploy it through the same platform model used by advanced users |
| Phase 5 | April 2027 and beyond | Explore advanced AI and multi-device experiences | Vision trigger experiments, wake word architecture decision, swarming/event sync prototypes, enterprise-ready scenario explorations | Advanced features are evaluated on top of stable contracts instead of one-off implementations |

## Phase Details

### Phase 0: Architecture and Baselines

This phase turns the remaining architectural and platform questions into explicit decisions.

Scope:

- Define how Stack-chan should be positioned in 2026:
  - hardware kit
  - firmware platform
  - conversational robot OS
  - foundation for a distributed AI agent ecosystem
- Decide what must be standardized first:
  - mod format
  - AI pipeline contract
  - structured log format
  - event bus boundary
- Establish the build pipeline and release flow needed for core artifacts:
  - define what gets built and validated on each change
  - define release boundaries between firmware, mods, and web tooling
  - make releases reproducible and reviewable
- Define the foundation for AI-driven development:
  - define repository-level conventions for `Skills` and `AGENTS.md`
  - define which tasks AI agents may execute autonomously and where human review is required
  - make `xst` and TypeScript checks part of the minimum validation gate for autonomous changes
- Capture baseline metrics:
  - time to first flash
  - time to first MOD iteration
  - failure points in environment setup
  - TTS glitch frequency under reference conditions

Recommended outputs:

- `docs/architecture/2026-platform-direction.md`
- `docs/specs/mod-format.md`
- `docs/specs/ai-pipeline.md`
- `docs/specs/log-schema.md`
- `docs/operations/build-pipeline.md`
- `docs/operations/release-flow.md`
- `docs/operations/ai-driven-development.md`
- `AGENTS.md`

### Phase 1: Browser-First Developer Experience

This phase addresses one of the biggest sources of developer overhead today: setup complexity.

Scope:

- Make firmware flashing, settings, and mod development feel like one connected browser workflow.
- Define whether mods stay source-based, become packaged bundles, or support both with a canonical transport format.
- Design the sandbox and permission model for browser-driven and LLM-generated mods.
- Establish a scenario/test format so browser execution results are reusable by humans, CI, and LLM tooling.
- Build a realistic simulator spike to determine how much of the current runtime can move to WebAssembly.

Priority outcomes:

- Zero-install or minimal-install flow for common tasks
- One-click write to device after validation
- Logs with `error_code`, trace, timing, and memory fields
- A clear policy for auto-fix loop stop conditions and human approval before flashing

### Phase 2: AI Stabilization

This phase turns AI Stack-chan from a promising demo path into a diagnosable system.

Scope:

- Instrument the audio path end to end.
- Isolate the dominant causes of choppy TTS:
  - network latency
  - buffer underflow
  - task scheduling contention
  - GC pauses
- Redesign buffer management if required.
- Improve key and secret provisioning so AI setup becomes secure but not hostile to developers.

Priority outcomes:

- Reproducible diagnostic scenarios
- Shared telemetry vocabulary for AI failures
- Documented performance envelope for supported reference devices

### Phase 3: Pluggable AI Pipeline

This phase reduces cost lock-in and enables experimentation.

Scope:

- Normalize the interface between STT, LLM, and TTS stages.
- Provide adapter implementations for the most important providers and reference local/cloud hybrids.
- Define latency budgets and fallback behavior per stage.
- Ensure application logic can stay provider-agnostic where practical.

Priority outcomes:

- A reference pipeline that supports vendor replacement
- Documentation for adapter contracts and expected capabilities
- A baseline for future embedded conversational robot integrations

### Phase 4: Ecosystem Tooling

This phase grows the creator ecosystem once the platform contracts are stable.

Scope:

- Ship a web-based face asset workflow.
- Standardize asset packaging and transfer.
- Decide when runtime asset loading is appropriate versus build-time embedding.
- Prototype a visual programming layer for children and first-time developers.
- Validate coexistence with advanced mod development rather than creating a separate ecosystem.

Priority outcomes:

- Asset tools that produce first-class platform artifacts
- An educational profile that lowers barriers without hiding the underlying model too much

### Phase 5: Advanced Capabilities

These items remain important, but they should not lead the roadmap until the platform core is in place.

Scope:

- Vision-based triggers and recognition
- Wake word detection
- Multi-device conversation and synchronized behavior
- Enterprise-ready and multilingual scenario validation

Required prerequisites:

- Stable AI pipeline contracts
- Defined event bus and synchronization model
- Reliable coexistence strategy for BLE and Wi-Fi
- Measured CPU, memory, and latency headroom on target hardware

## Dependency Rules

The roadmap intentionally enforces the following order:

- Browser tooling should not hard-code a temporary mod format that Phase 0 has not defined.
- Browser tooling and later platform work should build on the build pipeline and release flow established in Phase 0.
- AI-assisted development should not bypass the instruction model or validation gates established in Phase 0.
- Vision, wake word, and swarming should not proceed as primary investments before AI stabilization is complete.
- Visual programming should target the same runtime contracts as expert mod development.
- Enterprise-ready scenario work should follow, not precede, vendor-flexible AI pipeline design.

## Success Measures

The roadmap should be reviewed against measurable outcomes, not only shipped features.

- Developer onboarding:
  - first successful firmware flash from a supported browser in under 10 minutes
  - first sample mod iteration without local SDK setup in under 15 minutes
- Runtime quality:
  - structured telemetry available for TTS failures
  - diagnostic scenarios that distinguish network, buffering, scheduling, and GC causes
- Platform extensibility:
  - documented contracts for mod packaging, logs, and AI adapters
  - provider changes that mostly avoid application-level rewrites
- AI-driven development:
  - repository-level conventions exist for `Skills`, `AGENTS.md`, and autonomous task boundaries
  - autonomous changes are gated by `xst` and TypeScript checks
- Ecosystem growth:
  - browser tooling for faces and simple behaviors built on top of the same platform primitives

## Items Deferred Until Core Stability Exists

The following are valuable, but should remain explicitly deferred unless prerequisites are met:

- Full wasm simulator parity with device runtime
- Production-grade swarming for many devices
- Enterprise-ready and multilingual deployment packages
- Broad educational tooling rollout beyond prototype scope

## Review Cadence

- End of May 2026: architecture and baseline review
- End of August 2026: browser-first MVP review
- End of October 2026: AI stabilization review
- End of December 2026: pluggable AI platform review
- End of March 2027: ecosystem tooling review
