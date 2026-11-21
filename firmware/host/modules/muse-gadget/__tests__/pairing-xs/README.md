# Pairing XS boundary test

Run `bash run.sh` in the configured WSL SDK environment. This uses the real XS runtime, not a JavaScript native mock.

`generate.py` extracts the production `xs_pairing_finished` body and the finished branch of `xs_pairing_receive`. Crypto, session state and plaintext validation use synthetic stubs. The test calls the nested C entry points 100 times and verifies that `kind`, `generation` and `confirmationRequired` survive the two incremental variable allocations.

This proves that particular XS result/variable boundary only. It does not test phone interoperability, real decryption, expiry or hardware. Parser checks and upstream crypto tests remain in `native/pairing-tests`.
