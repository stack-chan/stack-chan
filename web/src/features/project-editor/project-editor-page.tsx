import {
  CopyPlus,
  Download,
  FileInput,
  FilePlus2,
  FolderOpen,
  ImagePlus,
  MoreHorizontal,
  RotateCw,
  Square,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { LogConsole } from '@/components/stackchan/log-console'
import { ModBuildControl } from '@/components/stackchan/mod-build-control'
import { SimulatorFrame } from '@/components/stackchan/simulator-frame'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BlocklyWorkspace } from '@/features/project-editor/blockly-workspace'
import { ProjectAssetsPanel } from '@/features/project-editor/project-assets-panel'
import { useProjectEditor } from '@/features/project-editor/use-project-editor'
import { DEVICE_PROFILES } from '../../../editor/capabilities.mjs'

function ProjectNameField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor="project-name">{t('プロジェクト名')}</Label>
      <Input
        id="project-name"
        value={draft}
        maxLength={64}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

export function ProjectEditorPage() {
  const editor = useProjectEditor()
  const { t } = useI18n()
  const importRef = useRef<HTMLInputElement>(null)
  const assetRef = useRef<HTMLInputElement>(null)
  const [samplesOpen, setSamplesOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)

  if (!editor.project) {
    return (
      <div className="page-container">
        <p className="text-sm text-muted-foreground" role="status">
          {t('プロジェクトを読み込んでいます')}
        </p>
      </div>
    )
  }

  const project = editor.project
  return (
    <>
      <div className="page-container grid min-w-0 gap-4">
        <section className="grid items-end gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,18rem)_auto]">
          <ProjectNameField value={project.name} onCommit={editor.setName} />
          <div className="grid gap-1">
            <Label htmlFor="target-device">{t('対象機種')}</Label>
            <Select value={project.target} onValueChange={(value) => value && editor.setTarget(value)}>
              <SelectTrigger id="target-device" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DEVICE_PROFILES).map(([value, profile]) => (
                  <SelectItem key={value} value={value}>
                    {t(profile.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" aria-label={t('プロジェクト操作')} />}>
              <MoreHorizontal />
              <span className="hidden sm:inline">{t('プロジェクト')}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-60">
              <DropdownMenuLabel>{t('プロジェクト操作')}</DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{t('最近開いたプロジェクト')}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-64">
                  {editor.projects.map((candidate) => (
                    <DropdownMenuItem key={candidate.id} onClick={() => editor.loadProject(candidate)}>
                      <span className="min-w-0">
                        <strong className="block truncate">{candidate.name}</strong>
                        <small className="text-muted-foreground">
                          {new Date(candidate.updatedAt).toLocaleString(editor.locale)}
                        </small>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={editor.newProject}>
                <FilePlus2 />
                {t('新しいプロジェクト')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={editor.duplicateProject}>
                <CopyPlus />
                {t('プロジェクトを複製')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => importRef.current?.click()}>
                <FolderOpen />
                {t('プロジェクトを読み込む')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={editor.exportProject}>
                <Download />
                {t('ファイルとして書き出す')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => assetRef.current?.click()}>
                <ImagePlus />
                {t('アセットを追加')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSamplesOpen(true)}>
                <FileInput />
                {t('サンプルを読み込む')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setClearOpen(true)}>
                <Trash2 />
                {t('ワークスペースを消去')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={importRef}
            className="sr-only"
            type="file"
            aria-label={t('プロジェクトを読み込む')}
            accept=".json,.stackchan-blocks.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void editor.importProject(file)
              event.currentTarget.value = ''
            }}
          />
          <input
            ref={assetRef}
            className="sr-only"
            type="file"
            aria-label={t('アセットを追加')}
            multiple
            onChange={(event) => {
              void editor.addAssets(Array.from(event.currentTarget.files ?? []))
              event.currentTarget.value = ''
            }}
          />
        </section>

        <div className="grid min-w-0 min-h-[calc(100dvh-12rem)] gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <BlocklyWorkspace
            initialWorkspace={project.workspace}
            target={project.target}
            locale={editor.locale}
            onChange={editor.onWorkspaceChange}
            onReady={editor.onWorkspaceReady}
          />
          <aside
            className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4"
            aria-label={t('MOD、アセットと出力')}
          >
            <ModBuildControl
              analysis={editor.analysis}
              buildOperation={editor.buildOperation}
              deviceOperation={editor.deviceOperation}
              archiveReady={Boolean(editor.archive)}
              onBuild={() => void editor.build()}
              onDownload={editor.downloadArchive}
              onRunSimulator={() => void editor.runInSimulator()}
              onInstallDevice={() => void editor.installToDevice()}
              onRemoveDevice={() => void editor.removeFromDevice()}
            />
            <ProjectAssetsPanel
              project={project}
              faceAssets={editor.faceAssets}
              onSelectFace={editor.selectFace}
              onEmbedAssetsChange={editor.setEmbedAssets}
              onRemoveAsset={editor.removeAsset}
              onEditFace={editor.editSelectedFace}
            />
            <Tabs defaultValue="code">
              <TabsList className="w-full">
                <TabsTrigger value="code">{t('生成コード')}</TabsTrigger>
                <TabsTrigger value="logs">{t('ログ')}</TabsTrigger>
                <TabsTrigger value="diagnostics">
                  {t('診断')}
                  <Badge variant="secondary">{editor.analysis.diagnostics.length}</Badge>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="code">
                <pre className="max-h-80 overflow-auto rounded-xl bg-console p-3 text-xs text-console-foreground">
                  <code>{editor.source || '// コードはまだ生成されていません'}</code>
                </pre>
              </TabsContent>
              <TabsContent value="logs">
                <LogConsole entries={editor.logs} onClear={editor.clearLogs} title={t('ビルドとインストールのログ')} />
              </TabsContent>
              <TabsContent value="diagnostics">
                <ol className="grid gap-2">
                  {editor.analysis.diagnostics.length === 0 ? (
                    <li className="rounded-lg border p-3 text-sm text-muted-foreground">{t('診断項目はありません')}</li>
                  ) : (
                    editor.analysis.diagnostics.map((diagnostic, index) => (
                      <li key={`${diagnostic.code}-${index}`}>
                        <button
                          className="w-full rounded-lg border p-3 text-left text-sm hover:bg-muted"
                          type="button"
                          onClick={() => editor.focusDiagnostic(diagnostic.blockId)}
                        >
                          <span className="mb-1 flex items-center gap-2">
                            <Badge variant={diagnostic.severity === 'error' ? 'destructive' : 'secondary'}>
                              {diagnostic.code}
                            </Badge>
                          </span>
                          {t(diagnostic.message)}
                        </button>
                      </li>
                    ))
                  )}
                </ol>
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>

      <Dialog open={samplesOpen} onOpenChange={setSamplesOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('サンプルを選ぶ')}</DialogTitle>
            <DialogDescription>{t('プロジェクトのワークスペースを選んだサンプルへ置き換えます。')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {editor.samples.map((sample) => (
              <Button
                key={sample.id}
                className="h-auto justify-start whitespace-normal py-3 text-left"
                variant="outline"
                onClick={() => {
                  editor.loadSample(sample.id)
                  setSamplesOpen(false)
                }}
              >
                <span>
                  <strong className="block">{t(sample.title)}</strong>
                  <small className="mt-1 block font-normal text-muted-foreground">{t(sample.description)}</small>
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('ワークスペースを消去しますか？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('現在のプロジェクトからすべてのブロックを取り除き、自動保存します。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('キャンセル')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                editor.clearWorkspace()
                setClearOpen(false)
              }}
            >
              {t('ワークスペースを消去')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(editor.confirmation)}
        onOpenChange={(open) => {
          if (!open) editor.resolveConfirmation(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{editor.confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{editor.confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => editor.resolveConfirmation(false)}>{t('キャンセル')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => editor.resolveConfirmation(true)}>
              {editor.confirmation?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={editor.simulatorOpen}
        onOpenChange={(open) => {
          if (!open) editor.closeSimulator()
        }}
      >
        <DialogContent className="h-[min(54rem,calc(100dvh-2rem))] sm:max-w-6xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('シミュレーター')}</DialogTitle>
            <DialogDescription>{t('ビルドしたMODをブラウザー内で実行します。')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={editor.restartSimulator}>
              <RotateCw />
              {t('再実行')}
            </Button>
            <Button variant="outline" onClick={editor.stopSimulator}>
              <Square />
              {t('停止')}
            </Button>
            <span className="ml-auto text-sm text-muted-foreground">{t('ボタン入力')}</span>
            {(['a', 'b', 'c'] as const).map((name) => (
              <Button key={name} variant="outline" size="icon" onClick={() => editor.pushSimulatorButton(name)}>
                {name.toUpperCase()}
              </Button>
            ))}
          </div>
          <SimulatorFrame
            ref={editor.simulatorFrameRef}
            src={editor.simulatorSrc}
            onMessage={editor.onSimulatorMessage}
            className="min-h-0 flex-1 rounded-xl border bg-simulator-stage"
          />
          <DialogFooter>
            <Button variant="outline" onClick={editor.closeSimulator}>
              {t('閉じる')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
