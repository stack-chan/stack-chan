---
"stack-chan": patch
---

Reuse an explicitly retained CoreS3 HTTPS connection across paths on the same origin, replacing all request headers and preserving certificate isolation. Allow the final request to consume and close the retained connection, reducing Live conversation startup handshakes without replaying session creation.
