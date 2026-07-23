import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { type FaceAsset, type FaceEye } from '@/features/face-editor/face-model'

type FacePart = 'left-eye' | 'right-eye' | 'mouth'

const eyeGeometry = (eye: FaceEye) => {
  const width = eye.shape === 'roundRect' ? (eye.width ?? 16) : (eye.radius ?? 8) * 2
  const height = eye.shape === 'roundRect' ? (eye.height ?? 16) : (eye.radius ?? 8) * 2
  const radius = eye.shape === 'roundRect' ? (eye.r ?? 0) : (eye.radius ?? 8)
  return {
    x: eye.x - width / 2,
    y: eye.y - height / 2,
    width,
    height,
    radius,
  }
}

const eyelidPath = (eye: FaceEye, side: 'left' | 'right', emotion: FaceAsset['emotion']) => {
  const left = eye.x - eye.eyelidWidth / 2
  const top = eye.y - eye.eyelidHeight / 2
  const right = left + eye.eyelidWidth
  const bottom = top + eye.eyelidHeight
  if (emotion === 'HAPPY') {
    const y = top + eye.eyelidHeight * 0.6
    return `M ${left} ${y} H ${right} V ${bottom} H ${left} Z`
  }
  if (emotion === 'SLEEPY') {
    const y = top + eye.eyelidHeight * 0.5
    return `M ${left} ${top} H ${right} V ${y} H ${left} Z`
  }
  if (emotion === 'ANGRY' || emotion === 'SAD') {
    const coverLeft = (emotion === 'ANGRY' && side === 'right') || (emotion === 'SAD' && side === 'left')
    const leftDepth = top + eye.eyelidHeight * (coverLeft ? 0.5 : 0)
    const rightDepth = top + eye.eyelidHeight * (coverLeft ? 0 : 0.5)
    return `M ${left} ${top} L ${left} ${leftDepth} L ${right} ${rightDepth} L ${right} ${top} Z`
  }
  return ''
}

export function FacePreview({
  asset,
  movePart,
}: {
  asset: FaceAsset
  movePart: (part: FacePart, x: number, y: number) => void
}) {
  const { t } = useI18n()
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ pointerId: number; part: FacePart; offsetX: number; offsetY: number } | undefined>(undefined)

  const partPosition = (part: FacePart) =>
    part === 'left-eye' ? asset.shape.eyes.left : part === 'right-eye' ? asset.shape.eyes.right : asset.shape.mouth

  const point = (event: PointerEvent) => {
    const bounds = svgRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * 320,
      y: ((event.clientY - bounds.top) / bounds.height) * 240,
    }
  }

  const startDrag = (part: FacePart, event: PointerEvent<SVGGElement>) => {
    const cursor = point(event)
    const position = partPosition(part)
    drag.current = {
      pointerId: event.pointerId,
      part,
      offsetX: cursor.x - asset.canvas.left - position.x,
      offsetY: cursor.y - asset.canvas.top - position.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()
    event.preventDefault()
  }

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    const cursor = point(event)
    movePart(
      active.part,
      Math.round(Math.min(asset.canvas.width, Math.max(0, cursor.x - asset.canvas.left - active.offsetX))),
      Math.round(Math.min(asset.canvas.height, Math.max(0, cursor.y - asset.canvas.top - active.offsetY)))
    )
  }

  const moveWithKeyboard = (part: FacePart, event: KeyboardEvent<SVGGElement>) => {
    const movement: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const direction = movement[event.key]
    if (!direction) return
    event.preventDefault()
    const current = partPosition(part)
    const step = event.shiftKey ? 5 : 1
    movePart(part, current.x + direction[0] * step, current.y + direction[1] * step)
  }

  const left = eyeGeometry(asset.shape.eyes.left)
  const right = eyeGeometry(asset.shape.eyes.right)
  const mouth = asset.shape.mouth
  const mouthWidth = mouth.minWidth + (mouth.maxWidth - mouth.minWidth) * (1 - asset.mouth)
  const mouthHeight = mouth.minHeight + (mouth.maxHeight - mouth.minHeight) * asset.mouth

  const partProps = (part: FacePart) => ({
    tabIndex: 0,
    role: 'button',
    onPointerDown: (event: PointerEvent<SVGGElement>) => startDrag(part, event),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => moveWithKeyboard(part, event),
    className:
      'cursor-grab outline-none focus-visible:[&>:first-child]:stroke-primary focus-visible:[&>:first-child]:stroke-2 active:cursor-grabbing',
  })

  return (
    <svg
      ref={svgRef}
      id="face-canvas"
      viewBox="0 0 320 240"
      aria-label={t('Shape型Faceのプレビュー')}
      className="aspect-4/3 w-full max-w-3xl touch-none select-none rounded-xl border-[10px] border-border bg-console shadow-2xl"
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        drag.current = undefined
      }}
      onPointerCancel={() => {
        drag.current = undefined
      }}
    >
      <rect x="0" y="0" width="320" height="240" fill="var(--console)" />
      <g transform={`translate(${asset.canvas.left} ${asset.canvas.top})`}>
        <rect x="0" y="0" width={asset.canvas.width} height={asset.canvas.height} fill={asset.colors.secondary} />
        <rect
          x="0"
          y="0"
          width={asset.canvas.width}
          height={asset.canvas.height}
          fill="none"
          stroke="var(--border)"
          strokeDasharray="4 4"
        />
        <g aria-label={t('左目')} {...partProps('left-eye')}>
          <rect
            x={left.x}
            y={left.y}
            width={left.width}
            height={left.height}
            rx={left.radius}
            ry={left.radius}
            fill={asset.colors.primary}
          />
          <path
            d={eyelidPath(asset.shape.eyes.left, 'left', asset.emotion)}
            fill={asset.colors.secondary}
            pointerEvents="none"
          />
        </g>
        <g aria-label={t('右目')} {...partProps('right-eye')}>
          <rect
            x={right.x}
            y={right.y}
            width={right.width}
            height={right.height}
            rx={right.radius}
            ry={right.radius}
            fill={asset.colors.primary}
          />
          <path
            d={eyelidPath(asset.shape.eyes.right, 'right', asset.emotion)}
            fill={asset.colors.secondary}
            pointerEvents="none"
          />
        </g>
        {mouth.visible && (
          <g aria-label={t('口')} {...partProps('mouth')}>
            <rect
              x={mouth.x - mouthWidth / 2}
              y={mouth.y - mouthHeight / 2}
              width={mouthWidth}
              height={mouthHeight}
              fill={asset.colors.primary}
            />
          </g>
        )}
      </g>
    </svg>
  )
}
