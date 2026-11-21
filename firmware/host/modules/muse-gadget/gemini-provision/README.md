# Private Gemini key provisioning

This temporary USB-only application saves the owner's approved existing Gemini key to NVS namespace `ai`, key `geminiToken`. It never writes `ai/token`, Wi-Fi preferences, Muse credentials, bootloader or OTA selection. Any existing `geminiToken`, including an invalid or differently typed value, blocks writing. Success requires commit plus native readback comparison.

The device starts no Wi-Fi or BLE and makes no API request. Credential bytes stay in native memory, never in JavaScript. The input window accepts one complete frame per reset and closes after 120 seconds. Public `CANARY` frames do not access NVS. Only fixed result strings are printed. Silent reboot and disabled core dumps prevent credential-bearing panic dumps.

## Saved-key source and host

Before use, the owner must approve reusing a particular DPAPI-encrypted key and saving it to the selected device. `host.ps1` accepts its local CLIXML path with `-KeyPath`, under the same Windows account that created it. Only a `SecureString` or a `PSCredential` containing a `SecureString` is accepted. The path is not the key: never put a plaintext key in any argument, environment variable or file. There is no plaintext-key prompt or child-process transfer. UNC paths and alternate data streams are rejected.

After checking USB identity, PowerShell decrypts to a short-lived BSTR, validates 20–512 printable ASCII characters without whitespace, and copies bytes directly into a bounded transmit array. It does not construct a managed plaintext key string. The BSTR is zeroed and released, the SecureString disposed, and transmit buffers cleared. The key is sent through `SerialPort` in that same process. A separate Python identity check receives no credential and runs before decryption and again before opening the port.

Select the previously verified device using the non-secret `-Port` and `-DeviceSerial` arguments. VID `303A` and PID `1001` are fixed for this target; a port or serial mismatch fails closed. These USB descriptors are an accidental-misdirection check, not cryptographic hardware authentication. Unknown, duplicate or malformed arguments fail without echoing their values. Host output contains only `SAVED`, `CANARY PASS`, or the fixed failure result. A failure does not prove that NVS stayed unchanged.

## Operator procedure

Build the target through the repository wrapper after its `--gemini-provision` selector is registered. Before replacing any firmware, obtain approval for the method and report offline verification. Check the live partition table and flash only the selected application partition. Do not use a whole-device flash command or erase NVS. The current StopWatch's active application begins at `0x20000`, unlike the build default.

With the temporary image running and serial monitors closed, check transport without loading the saved key:

```
powershell -NoProfile -File host.ps1 -Port COM7 -DeviceSerial VERIFIED_USB_SERIAL -Canary
```

Only after the owner-approved reuse and destination have been confirmed, perform saved-key provisioning:

```
powershell -NoProfile -File host.ps1 -Port COM7 -DeviceSerial VERIFIED_USB_SERIAL -KeyPath "C:\Private\gemini-key.clixml"
```

Replace the example port, serial and local file path with the owner-approved, verified values. Only those non-secret selectors belong on the command line. Do not print or inspect the CLIXML contents, decrypted value, process memory, or raw serial stream. Restore the normal application afterward using the same application-only procedure. The provisioning image cannot run voice conversations. Confirm only key presence in the normal application. API validity and paid speech/LLM tests are separate, unperformed steps.

## Limits

USB transmission is plaintext over the connected cable. Existing NVS and flash protection apply; this workflow does not enable encryption, modify security settings or burn eFuses. On the audited StopWatch configuration, flash and NVS encryption are disabled. Someone with physical flash access may read the saved key. OS, USB-driver and cryptographic implementation memory are outside the application's guaranteed wipe boundary.

## Offline tests

From `firmware/`:

```
bash host/modules/muse-gadget/gemini-provision/tests/run.sh
powershell -NoProfile -File host/modules/muse-gadget/gemini-provision/tests/test_host.ps1
```

The native ASan/UBSan tests mock USB and NVS, covering bounded parsing, malformed/binary/oversized frames, storage and readback failures, no-overwrite, canary isolation and resource cleanup. Host tests use synthetic SecureStrings and fake serial ports. They cover validation, both USB-identity gates, buffer clearing, fixed outputs, failed writes, wrong acknowledgments and canary independence from saved credentials. Tests do not open the real CLIXML, access USB or call an API.
