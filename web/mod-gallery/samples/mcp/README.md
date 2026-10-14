# MCP server package

`mod/` is the browser-visible copy of `firmware/mods/examples/mcp/`.
The MOD Gallery test requires the executable source files to stay byte-for-byte identical.

`mcp.xsa` targets XS 17.8.2 and is built with Moddable SDK 9.5.0 for the M5StackChan CoreS3 profile.

The MOD imports `ecma-wifi`, `mcp-server`, and `face-state` from the installed host.
Its archive contains only the MOD code; the host connectivity manifest exports `ecma-wifi`.
Do not include the host connectivity manifest in the MOD, which would bundle a second copy of host modules.
