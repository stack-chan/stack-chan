# Private USB SDK-token input

This is a separate, non-networked StopWatch target. It never starts BLE or Wi-Fi. The receiver owns the USB Serial/JTAG driver for at most 120 seconds, accepts one bounded ASCII frame, and keeps credential bytes only in native RAM. There is no echo or JavaScript credential value. A completed frame is wiped after processing; close wipes partial frames.

The native store writes only `muse_sdk/sdk_token`, rejects every existing key (including malformed values), and reports success only after commit plus readback verification. Storage protection depends on the device's existing NVS configuration. This target does not configure encryption, erase NVS, or burn eFuses. An unsuccessful/absent acknowledgment does not prove that no write happened.

## Before real use

Obtain the owner's explicit approval for the selected SDK token, this persistent destination, and its later encrypted transmission to the Muse phone app during pairing. Never ask them to paste a token into chat. The official community pairing has no manufacturer attestation and does not eliminate active MITM risk.

After approval, coordinate COM18, flash only the verified application partition with the `--sdk-provision` image, and let the owner run `python host.py --port COM18 --expected-serial <verified USB serial>` in their own terminal. The script requires a TTY, asks them to type `SAVE`, then reads the token with non-echo getpass. It accepts no token argument, environment variable, or credential file. It prints only fixed results and never serial contents. Its Python immutable strings cannot guarantee forensic RAM erasure; the mutable transmit buffer is wiped.

After success, replace the provisioning application with the `--setup` application. The user separately starts pairing, physically confirms the phone request, then approves device credential saving and connection. SDK-token presence alone is not service authentication or proof of valid permissions.

## Verification without credentials

`python host.py --port COM18 --canary` sends only `CANARY` and requires no hidden input. The receiver returns its fixed canary response without calling the storage function. Mock tests cover canary, malformed/oversized input, split frames and buffer wiping; host tests cover TTY refusal, hidden input shape validation, argument-error redaction, and canary transport. Real SDK-token provisioning and service authentication have not been performed.

The real-input path checks the selected USB VID/PID/serial before asking for the token and again before opening the port. A changed device fails closed. The current hardware read-only audit confirmed Secure Boot Disabled and Flash Encryption Disabled; the firmware also has NVS encryption disabled.
