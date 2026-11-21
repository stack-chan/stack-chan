export async function encryptToken(descriptor, token, cryptoProvider = globalThis.crypto) {
  if (descriptor?.v !== 1 || typeof descriptor.session !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(descriptor.session))
    throw new Error('Invalid session')
  if (
    !Number.isInteger(descriptor.remainingSeconds) ||
    descriptor.remainingSeconds < 1 ||
    descriptor.remainingSeconds > 600
  )
    throw new Error('Expired session')
  if (typeof token !== 'string' || !/^mgst_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token))
    throw new Error('Invalid token format')
  if (typeof descriptor.publicKey !== 'string' || descriptor.publicKey.length !== 392) throw new Error('Invalid key')
  const der = Uint8Array.from(atob(descriptor.publicKey), (c) => c.charCodeAt(0))
  if (der.length !== 294) throw new Error('Invalid key')
  const digest = new Uint8Array(await cryptoProvider.subtle.digest('SHA-256', der))
  const fingerprint = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (descriptor.fingerprint !== fingerprint) throw new Error('Key fingerprint mismatch')
  const key = await cryptoProvider.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ])
  if (key.algorithm.modulusLength !== 2048) throw new Error('Invalid key')
  const label = new TextEncoder().encode(descriptor.session)
  const clear = new TextEncoder().encode(`MUSESDK1\n${descriptor.session}\n${token}`)
  try {
    const encrypted = await cryptoProvider.subtle.encrypt({ name: 'RSA-OAEP', label }, key, clear)
    return { v: 1, session: descriptor.session, ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))) }
  } finally {
    clear.fill(0)
  }
}
