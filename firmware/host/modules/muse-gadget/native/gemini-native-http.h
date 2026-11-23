#pragma once
#include <stddef.h>
void *gemini_native_create(const char *, const char *, const void *, size_t, int);
int gemini_native_read(void *, void *, size_t);
void gemini_native_close(void *);
/* Construction reason: 1 input, 2 clock, 3 logging, 4 key, 5 busy, 6 allocation, 7 task. */
void *gemini_native_create_diagnostic(const char *, const char *, const void *, size_t, int, int *);
/* Fixed numeric diagnostic: stage * 1000000 + reason * 1000 + HTTP status (or 0).
 * Stages 1..8: created, task, init, connect, write, headers, read, complete.
 * Reasons 0..9: none, transport, cancel, deadline, allocation, certificate,
 * handshake, truncated, limit, HTTP status.
 * Reasons 10..17: socket unavailable, DNS, socket setup, TCP connect,
 * connect timeout, TLS setup, TLS I/O, unsupported transport.
 * No server strings are retained. */
int gemini_native_diagnostic(void *);
/* 100 * open class + errno class. Open 0..6: not called, OK, connect,
 * write, invalid transport, allocation, other. Errno 0..7: none, timeout,
 * refused, reset, network unreachable, host unreachable, allocation, other. */
int gemini_native_transport_diagnostic(void *);
