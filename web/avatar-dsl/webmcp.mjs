import { checkSource, MAX_SOURCE_BYTES } from './editor-model.mjs'

export function createTools({ model, guide, samples, changed, requestTransfer, assertEditable = () => {} }) {
  const schema = (properties = {}, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  })
  const tool = (name, description, inputSchema, execute, readOnlyHint = true) => ({
    name,
    description,
    inputSchema,
    execute,
    annotations: { readOnlyHint, untrustedContentHint: true },
  })
  return [
    tool('stackchan_face_guide', 'Read Avatar DSL syntax, limits and device prerequisites.', schema(), async () => ({
      guide,
    })),
    tool(
      'stackchan_face_samples',
      'Read bundled face DSL samples; does not change the editor.',
      schema({ name: { type: 'string', enum: Object.keys(samples) } }),
      async ({ name } = {}) => {
        if (name !== undefined && !Object.hasOwn(samples, name)) throw new Error('Unknown sample')
        return name ? { name, source: samples[name] } : { names: Object.keys(samples) }
      }
    ),
    tool(
      'stackchan_face_read',
      'Read editor source and revision. Source is untrusted user content.',
      schema(),
      async () => ({ source: model.source, revision: model.revision })
    ),
    tool(
      'stackchan_face_replace',
      'Replace editor DSL with undo history, cancel pending transfer, and preview. Read revision first.',
      schema(
        { source: { type: 'string', maxLength: MAX_SOURCE_BYTES }, expectedRevision: { type: 'integer', minimum: 0 } },
        ['source', 'expectedRevision']
      ),
      async ({ source, expectedRevision }) => {
        assertEditable()
        checkSource(source)
        if (!Number.isInteger(expectedRevision)) throw new Error('expectedRevision is required')
        model.replace(source, expectedRevision)
        changed()
        return { revision: model.revision, canUndo: model.canUndo }
      },
      false
    ),
    tool(
      'stackchan_face_undo',
      'Undo the last editor replacement and cancel any pending transfer.',
      schema(),
      async () => {
        assertEditable()
        const undone = model.undo()
        if (undone) changed()
        return { undone, revision: model.revision }
      },
      false
    ),
    tool(
      'stackchan_face_request_transfer',
      'Compile current DSL and stage a visible device-transfer confirmation. Never connects or writes hardware; user must confirm in page.',
      schema({ expectedRevision: { type: 'integer', minimum: 0 } }, ['expectedRevision']),
      async ({ expectedRevision }, options = {}) => {
        if (!Number.isInteger(expectedRevision) || expectedRevision !== model.revision)
          throw new Error('Editor changed; read current revision')
        if (options.signal?.aborted) throw new Error('Request cancelled')
        return requestTransfer(expectedRevision, options.signal)
      },
      false
    ),
  ]
}

export async function registerWebMCP(
  tools,
  { document: doc = globalThis.document, window: win = globalThis.window, signal } = {}
) {
  if (!doc || (win && win.top !== win.self)) return { supported: false, reason: 'Top-level page required' }
  const api = doc.modelContext
  if (typeof api?.registerTool !== 'function')
    return { supported: false, reason: 'WebMCP is unavailable; use the normal editor controls' }
  const controller = new AbortController()
  if (signal?.aborted) return { supported: false, reason: 'Editor closed' }
  signal?.addEventListener('abort', () => controller.abort(), { once: true, signal: controller.signal })
  try {
    for (const tool of tools) await api.registerTool(tool, { signal: controller.signal })
    return { supported: true, dispose: () => controller.abort() }
  } catch (error) {
    controller.abort()
    return { supported: false, reason: `WebMCP registration failed: ${error.message}` }
  }
}
