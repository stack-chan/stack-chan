---
"stack-chan": major
---

Unify OpenAI, Claude and Gemini text dialogue and MCP tools under the app-owned conversation SDK. Replace the old provider classes and raw fetch client, preserve SDK tool schemas through MCP, and fix fixed-length HTTP uploads and native successful completion handling. Require host API 10 for dialogue and MCP client packages so older hosts cannot ignore a provider selection and use the wrong service. Claude and Gemini require explicit provider keys and model IDs.

Configure TypeScript example manifests to resolve the JSDoc types of the shared settings schema, preserving key-specific SDK types during normal MOD builds.
