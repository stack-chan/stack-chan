---
"stack-chan": major
---

Remove the 24 unused flat context methods and getters for audio, motion, face, input and drawer. SDK ports and the remaining legacy namespaces now delegate directly to their existing runtime implementation. Retire the flat capability intersection and redundant context type aliases. New applications use the public SDK; legacy namespaced MODs remain scheduled for removal.
