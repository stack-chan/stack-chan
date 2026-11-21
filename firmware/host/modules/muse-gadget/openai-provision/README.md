# Private OpenAI key input for StopWatch

This temporary USB-only application saves one owner-supplied OpenAI key to NVS namespace `ai`, key `token`. That is the same preference read by Guruguru and the cascaded Muse setup target. It does not start Wi-Fi or BLE, contact OpenAI/Muse, display the key, or expose it to JavaScript. It never overwrites an existing value, including a malformed or differently typed value, and never erases or initializes NVS. Other namespaces are not written.

The owner uses the same OpenAI key they chose for Guruguru and Codezine. No new key is created and no key is retrieved from another application.

## Operator preparation

1. Build from `firmware/` with `node scripts/build-muse-native-device.mjs --openai-provision`.
2. Verify the USB device identity and its live partition table. Flash only its application partition after approval. Do not use the build's default whole-flash command: the current StopWatch uses `ota_0` at `0x20000`, while the build default differs. Preserve the partition table, bootloader, NVS and OTA selection.
3. Check transport without credentials using `host.py --port COM18 --expected-serial <verified USB serial> --canary`. This sends only the public `CANARY` frame and cannot call the NVS store.
4. Close the operator's serial monitors before the owner starts input. Do not run the real-input command through an agent execution tool or collect its input/output stream. The owner runs it in their own terminal.

## Owner input

From this directory in a local interactive terminal:

```
python host.py --port COM18 --expected-serial <verified USB serial>
```

Read the destination notice, type `SAVE`, then paste/type the key at `OpenAI API key (hidden):`. Input is not echoed. The key must not be put in the command itself, shell history, chat, a file, or an environment variable. The tool rejects non-interactive input and refuses to fall back to echoing input. Device VID/PID/serial are checked before asking for the key and again before opening USB.

`SAVED` means NVS commit and readback comparison succeeded. It does not prove the key is valid for OpenAI or that billing is enabled. If the result is not confirmed, storage may nevertheless have changed; do not assume it is safe to repeat or overwrite. An existing value is rejected without reading its contents. The application accepts at most one complete frame per reset and closes USB input after 120 seconds.

After input, the operator must reinstall the normal `--setup` application using the same verified application-only procedure. The provisioning image cannot run voice conversations. Confirm only the `openai_key_present` status, without reading or printing the key. A paid API test is a separate step. Restoring the setup application does not erase `ai.token` or Muse/Wi-Fi preferences.

## Security limits

USB transfer is plaintext over the physically connected cable. Storage protection follows the existing device configuration; this workflow does not enable encryption or burn eFuses. This device's provisioning build has NVS and flash encryption disabled. The key should be treated as readable by someone with physical flash access.

The application clears its mutable receive/readback buffers and the host clears mutable transmit buffers. Python's immutable strings and the USB driver's internal memory cannot be guaranteed to be forensically erased. The application disables panic dumps and uses silent reboot rather than printing a crash stack while the key is in memory. Neither these measures nor the USB serial identity constitute hardware authentication against a malicious replacement device.

## Offline verification

From `firmware/`:

```
bash host/modules/muse-gadget/openai-provision/tests/run.sh
python -m unittest discover -s host/modules/muse-gadget/openai-provision/tests -p test_host.py
```

The native test uses ASan/UBSan and mock USB/NVS. It checks one-byte framing, maximum length, malformed/oversized/binary input, partial-frame clearing, no overwrite, storage/readback faults, canary isolation and balanced resource ownership. Host tests mock all hardware and use public synthetic fixtures. These tests do not provision a real key or replace the real-device canary check.
