Uint8Array.fromBase64 ??= (value, { lastChunkHandling } = {}) => {
  const bytes = Buffer.from(value, 'base64')
  if (lastChunkHandling === 'strict' && bytes.toString('base64') !== value) throw new SyntaxError('invalid base64')
  return new Uint8Array(bytes)
}
