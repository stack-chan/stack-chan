import { describe, expect, it, vi } from 'vitest'
import { makeXsArchive, modDefinition } from '../../../../firmware/contracts/testing/xsa-fixture.js'

import { fetchModArchive, type ModArtifact } from '@/services/mod-gallery/mod-catalog-service'

const artifact: ModArtifact = {
  format: 'xsa',
  path: 'sample.xsa',
  target: 'simulator',
  url: new URL('https://example.test/sample.xsa'),
}

describe('fetchModArchive', () => {
  it('returns archive bytes and forwards an abort signal', async () => {
    const bytes = makeXsArchive()
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(bytes)
    })

    await expect(fetchModArchive(artifact, modDefinition, { fetcher })).resolves.toEqual(bytes)
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

      const request = fetchModArchive(artifact, modDefinition, { fetcher, timeoutMs: 100 })
      const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(100)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an artifact whose embedded identity or requirements differ from its catalog entry', async () => {
    const bytes = makeXsArchive()
    const fetcher = async () => new Response(bytes)
    for (const declaration of [
      { ...modDefinition, id: 'tech.stackchan.different' },
      { ...modDefinition, hostApiVersion: 3 },
      { ...modDefinition, capabilities: [] },
    ]) {
      await expect(fetchModArchive(artifact, declaration, { fetcher })).rejects.toMatchObject({
        code: 'MOD_METADATA_MISMATCH',
      })
    }
  })
})
