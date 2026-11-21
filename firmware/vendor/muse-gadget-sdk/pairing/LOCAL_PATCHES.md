# Local diagnostic changes

The `sha256` entries in `VENDOR_SOURCE.json` record the pinned upstream files. The `localSha256` entries record the three files changed by this patch.

`main/link_pairing.c` and `.h` add an opt-in decrypt diagnostic API. Its output is a fixed enum only: expired, state, envelope shape, session mismatch, counter mismatch, allocation, base64/tag length, or AEAD failure. The original decrypt API still returns the original generic error. Neither API logs field values, counters, plaintext or keys. Authentication, counter advancement and reset-on-failure remain mandatory. Failed plaintext allocations are wiped before release.

Two public-input selftests check the actual C library's unsigned 64-bit decimal formatting and Mbed TLS AES-256-GCM known-answer decryption. The latter checks the zero-key, zero-IV, zero-plaintext vector (ciphertext `cea7403d4d606b6e074ec5d3baf39d18`, tag `d0d1c8a799996bf0265b98b5d48ab919`) and rejects a modified tag. They do not touch pairing state, credentials, storage or networking. The formatting check covers zero and UINT64_MAX because the protocol uses PRIu64 for AAD and wire counters.

The actual-crypto handshake harness tests the fixed diagnostic categories (except allocation failure), success, both selftests and the existing upstream handshake cases. Allocation failure is classified in code but not fault-injected by this harness. Host PASS is not evidence of target C-library configuration; the device must run the same public-input checks separately.
