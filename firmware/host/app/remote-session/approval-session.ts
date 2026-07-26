import type { StackchanContext } from 'capabilities'
import type { Container as PiuContainer } from 'piu/MC'
import { Container, Label, Text } from 'piu/MC'
import Timer from 'timer'
import { ActionButton, ScreenHeader } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'
import {
  approvalPresented,
  approvalResponse,
  fitApprovalTitle,
  paginateApprovalDetail,
  type ApprovalDecision,
  type ApprovalRequest,
} from 'stackchan-approval-model'
import type { StackchanInboundApplicationEvent, StackchanOutboundApplicationEvent } from 'stackchan-application-event'
import type { RealtimeEventSendResult } from 'stackchan-realtime-session'

const RESPONSE_RETRY_MILLISECONDS = 2_000

type ApprovalEntry = {
  request: ApprovalRequest
  detailPages: string[]
  detailPage: number
  showingDetail: boolean
  suspended: boolean
  decision?: ApprovalDecision
}

export type ApprovalTransport = {
  sendApplicationEvent(event: StackchanOutboundApplicationEvent): Promise<RealtimeEventSendResult>
}

export type ApprovalSession = {
  handleEvent(event: StackchanInboundApplicationEvent): boolean
  close(): void
}

export function createApprovalSession(transport: ApprovalTransport, context: StackchanContext): ApprovalSession {
  const queue: ApprovalEntry[] = []
  let responseTimer: ReturnType<typeof Timer.repeat> | undefined
  let closed = false

  const active = () => queue[0]

  const clearResponseTimer = () => {
    if (responseTimer) Timer.clear(responseTimer)
    responseTimer = undefined
  }

  const send = (event: StackchanOutboundApplicationEvent) => {
    if (closed) return
    try {
      void transport.sendApplicationEvent(event).then(
        (result) => {
          if (result !== 'queued') trace(`[remote-approval] send deferred: ${result}\n`)
        },
        (error) => {
          trace(`[remote-approval] send failed: ${errorMessage(error)}\n`)
        },
      )
    } catch (error) {
      trace(`[remote-approval] send failed: ${errorMessage(error)}\n`)
    }
  }

  const sendPresented = (entry: ApprovalEntry) => {
    send(approvalPresented(entry.request.requestId))
  }

  const sendDecision = (entry: ApprovalEntry) => {
    if (!entry.decision || entry.suspended) return
    send(approvalResponse(entry.request.requestId, entry.decision))
  }

  const render = () => {
    const entry = active()
    if (!entry) {
      context.ui.showFace()
      return
    }
    context.ui.closeDrawer()
    context.ui.setMain(
      createApprovalView(entry, {
        decline: () => decide('decline'),
        approve: () => decide('approve'),
        toggleDetail: () => {
          if (entry.decision || entry.suspended) return
          if (!entry.showingDetail) {
            entry.showingDetail = true
            entry.detailPage = 0
          } else if (entry.detailPage + 1 < entry.detailPages.length) {
            entry.detailPage += 1
          } else {
            entry.showingDetail = false
            entry.detailPage = 0
          }
          render()
        },
      }),
    )
  }

  const startDecisionRetry = (entry: ApprovalEntry) => {
    clearResponseTimer()
    sendDecision(entry)
    responseTimer = Timer.repeat(() => {
      if (active() !== entry || !entry.decision || entry.suspended) return
      sendDecision(entry)
    }, RESPONSE_RETRY_MILLISECONDS)
  }

  const decide = (decision: ApprovalDecision) => {
    const entry = active()
    if (!entry || entry.decision || entry.suspended) return
    entry.decision = decision
    render()
    startDecisionRetry(entry)
  }

  const showNext = () => {
    clearResponseTimer()
    const entry = active()
    if (!entry) {
      context.ui.showFace()
      return
    }
    render()
    if (entry.decision) startDecisionRetry(entry)
    else sendPresented(entry)
  }

  const receiveRequest = (request: ApprovalRequest) => {
    const existing = queue.find((entry) => entry.request.requestId === request.requestId)
    if (existing) {
      existing.request = request
      existing.detailPages = detailPages(request)
      existing.detailPage = Math.min(existing.detailPage, existing.detailPages.length - 1)
      existing.suspended = false
      if (existing === active()) {
        render()
        if (existing.decision) startDecisionRetry(existing)
        else sendPresented(existing)
      }
      return
    }

    const entry: ApprovalEntry = {
      request,
      detailPages: detailPages(request),
      detailPage: 0,
      showingDetail: false,
      suspended: false,
    }
    queue.push(entry)
    if (active() === entry) showNext()
  }

  const resolveRequest = (requestId: string) => {
    const index = queue.findIndex((entry) => entry.request.requestId === requestId)
    if (index < 0) return
    const wasActive = index === 0
    queue.splice(index, 1)
    if (wasActive) showNext()
  }

  const suspendRequest = (requestId: string) => {
    const entry = queue.find((candidate) => candidate.request.requestId === requestId)
    if (!entry) return
    entry.suspended = true
    if (entry === active()) {
      clearResponseTimer()
      render()
    }
  }

  return {
    handleEvent(value) {
      switch (value.type) {
        case 'approval.request':
          receiveRequest(value)
          break
        case 'approval.resolved':
          resolveRequest(value.requestId)
          break
        case 'approval.suspended':
          suspendRequest(value.requestId)
          break
        default:
          return false
      }
      return true
    },
    close() {
      if (closed) return
      closed = true
      clearResponseTimer()
      queue.length = 0
      context.ui.showFace()
    },
  }
}

function detailPages(request: ApprovalRequest): string[] {
  const suffix = request.truncated ? '\n\n（末尾は省略されています）' : ''
  return paginateApprovalDetail(`${request.detail}${suffix}`)
}

type ApprovalViewActions = {
  decline(): void
  approve(): void
  toggleDetail(): void
}

function createApprovalView(entry: ApprovalEntry, actions: ApprovalViewActions): PiuContainer {
  const styles = uiStyles()
  const buttonsEnabled = !entry.decision && !entry.suspended
  const pageNumber = entry.detailPage + 1
  const pageCount = entry.detailPages.length
  const body = entry.showingDetail ? entry.detailPages[entry.detailPage] : entry.request.summary
  const kind = entry.request.kind === 'command' ? 'コマンド実行' : 'ファイル変更'
  const status = entry.suspended
    ? '再接続を待っています'
    : entry.decision
      ? entry.decision === 'approve'
        ? 'OKを送信中…'
        : 'NGを送信中…'
      : entry.showingDetail
        ? `詳細 ${pageNumber}/${pageCount}`
        : `${kind}の承認要求`
  const detailLabel = entry.showingDetail && pageNumber < pageCount ? '次へ' : entry.showingDetail ? '要約' : '詳細'

  return new Container(null, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    skin: styles.screen,
    contents: [
      new ScreenHeader({
        title: fitApprovalTitle(entry.request.title),
      }),
      new Text(null, {
        left: 14,
        right: 14,
        top: UI.headerHeight + 12,
        bottom: 72,
        string: body,
        style: styles.body,
      }),
      new Label(null, {
        left: 12,
        right: 12,
        bottom: 52,
        height: 16,
        string: status,
        style: entry.suspended ? styles.bodyMuted : styles.body,
      }),
      new ActionButton(
        {
          icon: 'close',
          label: 'NG',
          enabled: buttonsEnabled,
          onTap: actions.decline,
          tone: 'danger',
        },
        { left: 8, bottom: 4, width: 92 },
      ),
      new ActionButton(
        {
          icon: 'apps',
          label: detailLabel,
          enabled: buttonsEnabled,
          onTap: actions.toggleDetail,
          selected: entry.showingDetail,
        },
        { left: 106, bottom: 4, width: 108 },
      ),
      new ActionButton(
        {
          icon: 'play',
          label: 'OK',
          enabled: buttonsEnabled,
          onTap: actions.approve,
          tone: 'success',
        },
        { right: 8, bottom: 4, width: 92 },
      ),
    ],
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
