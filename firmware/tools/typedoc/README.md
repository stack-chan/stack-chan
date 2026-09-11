# TypeDoc toolchain

API generation uses TypeDoc 0.28.20 and its supported TypeScript 6.0.3 compiler in this isolated workspace. The package declaration and lockfile pin the same version. Firmware builds and `check:sdk` continue to use the main TypeScript toolchain.

From `firmware/`, run `npm run generate-apidoc`. It first runs the SDK checks, then TypeDoc checks and documents only `sdk/**/*.ts` using `tsconfig.apidoc.json`. It does not skip compiler errors or expand host implementations, examples or fixtures.

`typedoc.json` writes Markdown and a JSON reflection model under `firmware/dist/docs/sdk`. These are generated outputs; edit the SDK source, not the generated pages. The settings types come from the canonical JSDoc schema through the SDK export.

[TypeDoc 0.28.18 added TypeScript 6 support](https://typedoc.org/documents/Changelog.html#v02818-2026-03-23). Review this isolated dependency when updating the documentation generator.
