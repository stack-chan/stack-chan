import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

import { useI18n } from '@/app/i18n-provider'

export type SimulatorFrameHandle = {
  postCommand: (command: string, detail?: Record<string, unknown>) => void
  restart: () => void
  pushButton: (name: 'a' | 'b' | 'c') => void
  stop: () => void
}

export function SimulatorFrame({
  title = 'Webシミュレーター',
  src = '../simulator/',
  className,
  onMessage,
  ref,
}: {
  title?: string
  src?: string
  className?: string
  onMessage?: (message: unknown) => void
  ref?: Ref<SimulatorFrameHandle>
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const { t } = useI18n()

  useImperativeHandle(
    ref,
    () => ({
      postCommand(command, detail = {}) {
        frameRef.current?.contentWindow?.postMessage(
          { type: 'stackchan-editor-command', command, ...detail },
          location.origin
        )
      },
      restart() {
        frameRef.current?.contentWindow?.postMessage(
          { type: 'stackchan-editor-command', command: 'restart' },
          location.origin
        )
      },
      pushButton(name) {
        frameRef.current?.contentWindow?.postMessage(
          { type: 'stackchan-editor-command', command: 'button', name },
          location.origin
        )
      },
      stop() {
        if (frameRef.current) frameRef.current.src = 'about:blank'
      },
    }),
    []
  )

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frameRef.current?.contentWindow) return
      onMessage?.(event.data)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [onMessage])

  return (
    <iframe
      ref={frameRef}
      className={className ?? 'min-h-[28rem] w-full rounded-xl border bg-simulator-stage'}
      title={t(title)}
      src={src}
      allow="camera; microphone"
    />
  )
}
