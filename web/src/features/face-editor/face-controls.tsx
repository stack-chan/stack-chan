import { type ReactNode } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { type FaceAsset, type FaceEye, type FaceEmotion } from '@/features/face-editor/face-model'

type EyeSide = 'left' | 'right'

export function FaceControls({
  asset,
  update,
}: {
  asset: FaceAsset
  update: (mutate: (draft: FaceAsset) => void) => void
}) {
  const { t } = useI18n()

  const numberInput = (
    id: string,
    label: string,
    value: number,
    onChange: (value: number) => void,
    options: { min?: number; max?: number; step?: number; readOnly?: boolean } = {}
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {t(label)}
      </Label>
      <Input
        id={id}
        type="number"
        value={value}
        min={options.min}
        max={options.max}
        step={options.step ?? 1}
        readOnly={options.readOnly}
        aria-readonly={options.readOnly}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )

  const section = (title: string, children: ReactNode) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t(title)}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )

  const updateEye = (side: EyeSide, mutate: (eye: FaceEye) => void) => {
    update((draft) => {
      const eye = draft.shape.eyes[side]
      mutate(eye)
      if (eye.shape === 'roundRect') {
        eye.eyelidWidth = eye.width ?? 16
        eye.eyelidHeight = eye.height ?? 16
      } else {
        eye.eyelidWidth = (eye.radius ?? 8) * 2
        eye.eyelidHeight = (eye.radius ?? 8) * 2
      }
    })
  }

  const eyeControls = (side: EyeSide, title: string) => {
    const eye = asset.shape.eyes[side]
    const prefix = `${side}-eye`
    return section(
      title,
      <div className="grid gap-3">
        <p className="text-xs leading-5 text-muted-foreground">
          {t('まぶたは目と同じ中心に置かれ、瞳全体を覆う大きさに保たれます。')}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${prefix}-shape`} className="text-xs text-muted-foreground">
              {t('瞳形状')}
            </Label>
            <Select
              value={eye.shape}
              onValueChange={(value) =>
                value &&
                updateEye(side, (draft) => {
                  if (value === 'roundRect') {
                    const diameter = (draft.radius ?? 8) * 2
                    draft.shape = 'roundRect'
                    draft.width = draft.width ?? diameter
                    draft.height = draft.height ?? diameter
                    draft.r = draft.r ?? Math.min(diameter / 2, 4)
                  } else {
                    draft.shape = 'circle'
                    draft.radius = draft.radius ?? Math.min(draft.width ?? 16, draft.height ?? 16) / 2
                  }
                })
              }
            >
              <SelectTrigger id={`${prefix}-shape`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="circle">{t('円')}</SelectItem>
                <SelectItem value="roundRect">{t('角丸矩形')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {numberInput(`${prefix}-x`, 'X', eye.x, (value) => updateEye(side, (draft) => (draft.x = value)), {
            min: 0,
            max: asset.canvas.width,
          })}
          {numberInput(`${prefix}-y`, 'Y', eye.y, (value) => updateEye(side, (draft) => (draft.y = value)), {
            min: 0,
            max: asset.canvas.height,
          })}
          {eye.shape === 'circle' ? (
            numberInput(
              `${prefix}-radius`,
              '瞳半径',
              eye.radius ?? 8,
              (value) => updateEye(side, (draft) => (draft.radius = value)),
              { min: 2, max: 40 }
            )
          ) : (
            <>
              {numberInput(
                `${prefix}-width`,
                '幅',
                eye.width ?? 16,
                (value) => updateEye(side, (draft) => (draft.width = value)),
                { min: 4, max: 120 }
              )}
              {numberInput(
                `${prefix}-height`,
                '高さ',
                eye.height ?? 16,
                (value) => updateEye(side, (draft) => (draft.height = value)),
                { min: 4, max: 120 }
              )}
              {numberInput(`${prefix}-r`, 'R', eye.r ?? 4, (value) => updateEye(side, (draft) => (draft.r = value)), {
                min: 0,
                max: Math.min(eye.width ?? 16, eye.height ?? 16) / 2,
              })}
            </>
          )}
          {numberInput(`${side}-eyelid-width`, 'まぶた幅（自動）', eye.eyelidWidth, () => {}, {
            readOnly: true,
          })}
          {numberInput(`${side}-eyelid-height`, 'まぶた高さ（自動）', eye.eyelidHeight, () => {}, {
            readOnly: true,
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="grid content-start gap-4">
      {section(
        '基本設定',
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="face-name">{t('名前')}</Label>
            <Input
              id="face-name"
              value={asset.name}
              maxLength={64}
              onChange={(event) => update((draft) => (draft.name = event.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="face-emotion">{t('初期表情')}</Label>
            <Select
              value={asset.emotion}
              onValueChange={(value) => value && update((draft) => (draft.emotion = value as FaceEmotion))}
            >
              <SelectTrigger id="face-emotion" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  ['NEUTRAL', 'ふつう'],
                  ['HAPPY', 'うれしい'],
                  ['ANGRY', 'おこった'],
                  ['SAD', 'かなしい'],
                  ['SLEEPY', 'ねむい'],
                  ['DOUBTFUL', 'こまった'],
                  ['COLD', 'さむい'],
                  ['HOT', 'あつい'],
                ].map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {t(label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="primary-color">{t('主色')}</Label>
              <Input
                id="primary-color"
                type="color"
                value={asset.colors.primary}
                onChange={(event) => update((draft) => (draft.colors.primary = event.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="secondary-color">{t('背景色')}</Label>
              <Input
                id="secondary-color"
                type="color"
                value={asset.colors.secondary}
                onChange={(event) => update((draft) => (draft.colors.secondary = event.target.value))}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mouth-open">{t('口の初期開度')}</Label>
            <div className="grid grid-cols-[1fr_3rem] items-center gap-2">
              <input
                id="mouth-open"
                className="accent-primary"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={asset.mouth}
                onChange={(event) => update((draft) => (draft.mouth = Number(event.target.value)))}
              />
              <output htmlFor="mouth-open" className="text-right text-sm tabular-nums">
                {asset.mouth.toFixed(2)}
              </output>
            </div>
          </div>
        </div>
      )}
      {section(
        'Face領域',
        <div className="grid grid-cols-2 gap-3">
          {(['left', 'top', 'width', 'height'] as const).map((field) =>
            numberInput(
              `canvas-${field}`,
              { left: '左', top: '上', width: '幅', height: '高さ' }[field],
              asset.canvas[field],
              (value) => update((draft) => (draft.canvas[field] = value)),
              {
                min: field === 'width' || field === 'height' ? 40 : 0,
                max: field === 'left' || field === 'width' ? 320 : 240,
              }
            )
          )}
        </div>
      )}
      {eyeControls('left', '左目')}
      {eyeControls('right', '右目')}
      {section(
        '口',
        <div className="grid gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="mouth-visible"
              checked={asset.shape.mouth.visible}
              onCheckedChange={(checked) => update((draft) => (draft.shape.mouth.visible = checked === true))}
            />
            {t('口を描画する')}
          </label>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {(
              [
                ['x', 'X', 0, asset.canvas.width],
                ['y', 'Y', 0, asset.canvas.height],
                ['minWidth', '開いた幅', 1, asset.canvas.width],
                ['maxWidth', '閉じた幅', 1, asset.canvas.width],
                ['minHeight', '閉じた高さ', 1, asset.canvas.height],
                ['maxHeight', '開いた高さ', 1, asset.canvas.height],
              ] as const
            ).map(([field, label, min, max]) =>
              numberInput(
                `mouth-${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)}`,
                label,
                asset.shape.mouth[field],
                (value) => update((draft) => (draft.shape.mouth[field] = value)),
                { min, max }
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
