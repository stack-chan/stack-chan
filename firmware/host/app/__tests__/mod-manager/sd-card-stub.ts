const archive = new Uint8Array([0, 0, 0, 20, 88, 83, 95, 65, 0, 0, 0, 12, 86, 69, 82, 83, 1, 0, 0, 0]).buffer

export default Object.freeze({
  list: () => ['demo.xsa'],
  read: (_name: string, _maximumBytes: number) => archive.slice(0),
  xsVersionRange: () => [1, 0, 1, 0] as const,
})
