# Separate ECMA-419 Files partition on ESP32

Include this manifest instead of the SDK Files manifest when both legacy `file`
and `embedded:storage/files` are used. Set `defines.files.partition` to the desired
ECMA-419 partition label (for example `"#journal"`). Legacy File continues to use
`defines.file.partition`. Without the plural setting, SDK partition selection is
preserved; do not mount both APIs on the same partition simultaneously.

The ESP32 GNU Make compiler options rename the partition lookup only while
compiling `files-littlefs.c.o`. The adapter selects the configured label using the
public ESP-IDF partition API. A second rename separates the SDK's global error
table from the legacy LittleFS module. No SDK source is copied or edited.

When updating the SDK, verify that the generated object is still named
`files-littlefs.c.o`, references `stackchanFilesPartitionFindFirst`, and has its own
`stackchanFilesErrors` symbol. Both APIs must retain separate mounts. This build
integration currently supports the ESP32 GNU Make toolchain.
