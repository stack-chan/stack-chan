import { act, createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { SimulatorFrame, type SimulatorFrameHandle } from '@/components/stackchan/simulator-frame'

describe('SimulatorFrame', () => {
  it('owns simulator commands, trusted messages, and frame shutdown', () => {
    const controller = createRef<SimulatorFrameHandle>()
    const onMessage = vi.fn()
    render(
      <I18nProvider>
        <SimulatorFrame ref={controller} src="/simulator/" onMessage={onMessage} />
      </I18nProvider>
    )
    const frame = screen.getByTitle('Webシミュレーター') as HTMLIFrameElement
    const postMessage = vi.fn()
    const contentWindow = { postMessage }
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: contentWindow })

    act(() => {
      controller.current?.restart()
      controller.current?.pushButton('b')
    })
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      { type: 'stackchan-editor-command', command: 'restart' },
      location.origin
    )
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      { type: 'stackchan-editor-command', command: 'button', name: 'b' },
      location.origin
    )

    const foreignMessage = new MessageEvent('message', {
      data: { type: 'stackchan-simulator-ready', runCount: 99 },
      origin: 'https://example.test',
    })
    Object.defineProperty(foreignMessage, 'source', { value: contentWindow })
    act(() => window.dispatchEvent(foreignMessage))
    expect(onMessage).not.toHaveBeenCalled()

    const message = new MessageEvent('message', {
      data: { type: 'stackchan-simulator-ready', runCount: 1 },
      origin: location.origin,
    })
    Object.defineProperty(message, 'source', { value: contentWindow })
    act(() => window.dispatchEvent(message))
    expect(onMessage).toHaveBeenCalledWith({ type: 'stackchan-simulator-ready', runCount: 1 })

    act(() => controller.current?.stop())
    expect(frame).toHaveAttribute('src', 'about:blank')
  })
})
