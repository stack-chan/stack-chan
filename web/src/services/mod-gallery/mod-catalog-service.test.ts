import { describe, expect, it, vi } from 'vitest'

import { fetchModArchive, type ModArtifact } from '@/services/mod-gallery/mod-catalog-service'

const artifact: ModArtifact = {
  format: 'xsa',
  path: 'sample.xsa',
  target: 'simulator',
  url: new URL('https://example.test/sample.xsa'),
}

describe('fetchModArchive', () => {
  it('returns archive bytes and forwards an abort signal', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(new Uint8Array([1, 2, 3]))
    })

    await expect(fetchModArchive(artifact, { fetcher })).resolves.toEqual(new Uint8Array([1, 2, 3]))
  })

  it('aborts a stalled archive request after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          })
      )

      const request = fetchModArchive(artifact, { fetcher, timeoutMs: 100 })
      const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(100)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })
})
