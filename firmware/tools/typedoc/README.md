# TypeDoc toolchain

TypeDoc 0.28 does not support TypeScript 7, so API generation uses TypeScript 6 in this isolated workspace.
Type checking stays with the firmware build and test commands because the expanded documentation inputs include Moddable modules and fixtures.
Remove this split once TypeDoc officially supports TypeScript 7.
