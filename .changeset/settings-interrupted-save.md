---
"stack-chan": patch
---

Recover interrupted settings batches before reading device configuration. Persist an undo record in NVS blob storage, confirm writes, and retain the record until every field is saved or restored. Stop reads and writes after failed recovery. Remove the unused manual Wi-Fi settings facade and the MCP server's independent Preference fallback.
