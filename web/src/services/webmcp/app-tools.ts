import { z } from 'zod'
import { useI18n } from '@/app/i18n-provider'
import { TOOL_NAVIGATION_ITEMS, GUIDE_NAVIGATION_ITEMS, type NavigationId } from '@/app/navigation'
import { getGuides } from '@/features/guide/guide-content'
import { useOperations, useWebMcpTools } from './react'
import { emptyInput, getModelContext, ToolError } from './runtime'

export function useAppTools(current: NavigationId, rootHref: string) {
  const { locale, t } = useI18n()
  const operations = useOperations()
  const pages = [...TOOL_NAVIGATION_ITEMS, ...GUIDE_NAVIGATION_ITEMS].map((item) => ({
    id: item.id,
    title: t(item.label),
    description: t(item.description),
    url: new URL(item.href, new URL(rootHref, location.href)).href,
  }))
  useWebMcpTools([
    {
      name: 'stackchan.app.get_context',
      description: 'Read the current page, available destinations, browser capabilities and recent operations.',
      schema: emptyInput,
      readOnly: true,
      execute: () => ({
        current,
        locale,
        pages,
        webmcp: Boolean(getModelContext()),
        registrations: Object.fromEntries(operations.registrations),
        bluetooth: 'bluetooth' in navigator,
        serial: 'serial' in navigator,
        operations: operations.list(),
      }),
    },
    {
      name: 'stackchan.app.get_guide',
      description: 'Get Stack-chan usage instructions and agent prompt examples. Omit topic to list all topics.',
      schema: z.object({ topic: z.string().optional() }).strict(),
      readOnly: true,
      execute: ({ topic }) => {
        const guides = getGuides(locale).map((guide) => ({
          ...guide,
          ...(guide.href ? { href: new URL(guide.href, new URL(rootHref, location.href)).href } : {}),
        }))
        if (!topic) return guides
        const guide = guides.find((item) => item.id === topic)
        if (!guide) throw new ToolError('not_found', '説明が見つかりません。')
        return guide
      },
    },
    {
      name: 'stackchan.app.navigate',
      description: 'Open a Stack-chan tool or guide by page ID. Read the destination context after navigation.',
      schema: z.object({ page: z.string() }).strict(),
      execute: async ({ page }) => {
        if (operations.busy()) throw new ToolError('busy', '実行中の操作が終わってから移動してください。')
        const destination = pages.find((item) => item.id === page)
        if (!destination) throw new ToolError('not_found', 'ページが見つかりません。')
        await operations.beforeNavigate()
        if (operations.busy()) throw new ToolError('busy', '実行中の操作が終わってから移動してください。')
        location.assign(destination.url)
        return { navigating: destination.id }
      },
    },
    {
      name: 'stackchan.app.get_operation',
      description: 'Read an operation result, progress stage or required user action by ID.',
      schema: z.object({ operationId: z.string() }).strict(),
      readOnly: true,
      untrusted: true,
      execute: ({ operationId }) => operations.get(operationId),
    },
    {
      name: 'stackchan.app.cancel_operation',
      description: 'Cancel an operation before irreversible device writing starts.',
      schema: z.object({ operationId: z.string() }).strict(),
      execute: ({ operationId }) => operations.cancel(operationId),
    },
  ])
}
