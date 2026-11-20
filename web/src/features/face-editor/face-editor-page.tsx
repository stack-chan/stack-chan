import { Blocks, Download, FolderOpen, RotateCcw } from 'lucide-react'
import { useRef } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FaceControls } from '@/features/face-editor/face-controls'
import { faceAssetMediaType, parseFaceAssetFile, type FaceAsset } from '@/features/face-editor/face-model'
import { FacePreview } from '@/features/face-editor/face-preview'
import { useFaceEditor } from '@/features/face-editor/use-face-editor'

type FacePart = 'left-eye' | 'right-eye' | 'mouth'

export function FaceEditorPage({
  renderShell,
}: {
  renderShell: (actions: React.ReactNode, content: React.ReactNode) => React.ReactNode
}) {
  const { t } = useI18n()
  const editor = useFaceEditor()
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async (file: File) => {
    try {
      const asset = parseFaceAssetFile(await file.text())
      editor.replace(asset, `「${asset.name}」を読み込みました。`)
    } catch (error) {
      editor.setStatus({
        message: `Shape顔を読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
        kind: 'error',
      })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const download = () => {
    const blob = new Blob([`${JSON.stringify(editor.asset, null, 2)}\n`], {
      type: faceAssetMediaType,
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${editor.asset.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}.stackchan-face.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    editor.setStatus({ message: 'Shape顔プロジェクトを保存しました。', kind: 'success' })
  }

  const movePart = (part: FacePart, x: number, y: number) =>
    editor.update((draft: FaceAsset) => {
      const target =
        part === 'left-eye' ? draft.shape.eyes.left : part === 'right-eye' ? draft.shape.eyes.right : draft.shape.mouth
      target.x = x
      target.y = y
    })

  const actions = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".stackchan-face.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void load(file)
        }}
      />
      <Button
        id="load-face"
        variant="ghost"
        size="icon"
        title={t('Shape顔を読み込む')}
        aria-label={t('Shape顔を読み込む')}
        onClick={() => fileRef.current?.click()}
      >
        <FolderOpen />
      </Button>
      <Button
        id="reset-face"
        variant="ghost"
        size="icon"
        title={t('標準配置に戻す')}
        aria-label={t('標準配置に戻す')}
        onClick={editor.reset}
      >
        <RotateCcw />
      </Button>
      <Button
        id="download-face"
        variant="outline"
        title={t('JSONを保存')}
        aria-label={t('JSONを保存')}
        onClick={download}
      >
        <Download data-icon="inline-start" />
        <span className="hidden sm:inline">{t('JSONを保存')}</span>
      </Button>
      <Button
        id="send-to-editor"
        title={t(editor.edit ? '変更を反映' : 'MODで使う')}
        aria-label={t(editor.edit ? '変更を反映' : 'MODで使う')}
        onClick={editor.stageForEditor}
      >
        <Blocks data-icon="inline-start" />
        <span className="hidden sm:inline">{t(editor.edit ? '変更を反映' : 'MODで使う')}</span>
      </Button>
    </>
  )

  const content = (
    <div className="grid min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(28rem,1fr)_minmax(22rem,28rem)]">
      <section
        className="grid min-h-[38rem] content-start gap-5 overflow-auto bg-simulator-stage p-4 sm:p-6 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)]"
        aria-labelledby="preview-heading"
      >
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs tracking-widest text-muted-foreground uppercase">320 × 240 preview</p>
            <h1 id="preview-heading" className="text-xl font-semibold">
              Shape Face
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{t('目と口をドラッグして配置できます。')}</p>
        </header>
        <div className="grid min-h-72 place-items-center">
          <FacePreview asset={editor.asset} movePart={movePart} />
        </div>
        <p
          role="status"
          className={
            editor.status.kind === 'error'
              ? 'text-sm text-destructive'
              : editor.status.kind === 'success'
                ? 'text-sm text-success'
                : 'text-sm text-muted-foreground'
          }
        >
          {t(editor.status.message)}
        </p>
        <Card className="overflow-hidden p-0">
          <details>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t('生成されるFace実装')}</summary>
            <pre
              id="shape-code-preview"
              className="max-h-64 overflow-auto border-t bg-console p-4 text-xs leading-5 whitespace-pre-wrap text-console-foreground"
            >
              {editor.code}
            </pre>
          </details>
        </Card>
      </section>
      <aside className="overflow-auto border-l bg-card p-4 sm:p-5 lg:h-[calc(100dvh-4rem)]">
        <FaceControls asset={editor.asset} update={editor.update} />
      </aside>
    </div>
  )

  return renderShell(actions, content)
}
