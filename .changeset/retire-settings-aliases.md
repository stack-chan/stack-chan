---
"stack-chan": major
"stackchan-web": major
---

Remove the unused PREF_KEYS tuple export and stop importing the retired renderer.type preference. Select the face with the canonical ui.type setting. Reading settings no longer copies old renderer values into persistent storage.

Require framed settings protocol 2 with a complete snapshot and ready marker before the Web tools enable saving. Remove unacknowledged sends to older firmware and single-setting request envelopes. A successful save always includes a matching device acknowledgement and application timing; failures preserve edits for retry. Use the Web tools and firmware from the same release.
