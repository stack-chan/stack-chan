import { Blocks, LifeBuoy } from 'lucide-react'

import { useI18n } from '@/app/i18n-provider'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const lessons = [
  {
    id: 'five',
    time: '5分',
    title: 'シミュレーターで表情を動かす',
    steps: [
      'エディタのサンプルボタンから「1. あいさつと表情」を選びます。',
      '「スタートしたとき」の内側にある表情や吹き出しを変更します。',
      '診断が0件であることを確認して「ビルド」を押します。',
      '「シミュレーターで実行」を押し、顔と吹き出しの変化を確認します。',
    ],
  },
  {
    id: 'fifteen',
    time: '15分',
    title: 'ボタンやセンサーに反応させる',
    steps: [
      '「2. ボタンでリアクション」か「4. センサーとLED」を読み込みます。',
      'イベントの内側へ発話、表情、姿勢のブロックを接続します。',
      '対象機種を選び、未対応能力の診断がないことを確認します。',
      'シミュレーターダイアログのA、B、Cボタンで入力を試します。',
      '条件やくり返しを追加し、停止しない処理がないことを確かめます。',
    ],
  },
]

export function TutorialPage() {
  const { t } = useI18n()
  return (
    <div className="page-container max-w-4xl space-y-6 py-10">
      <header className="space-y-4">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">Visual Programming</p>
        <h1 className="page-heading">{t('作って、動かして、少しずつ広げる')}</h1>
        <p className="page-lead">{t('実機へ書き込む前に、ブラウザのシミュレーターで表情と動きを確かめられます。')}</p>
        <Button render={<a href="./" />}>
          <Blocks data-icon="inline-start" />
          {t('エディタを開く')}
        </Button>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={t('学習コース')}>
        <Button variant="outline" size="sm" render={<a href="#five" />}>
          {t('5分：表情')}
        </Button>
        <Button variant="outline" size="sm" render={<a href="#fifteen" />}>
          {t('15分：入力')}
        </Button>
        <Button variant="outline" size="sm" render={<a href="#thirty" />}>
          {t('30分：顔アセット')}
        </Button>
      </nav>

      {lessons.map((lesson) => (
        <Card key={lesson.id} id={lesson.id} className="scroll-mt-20">
          <CardHeader className="sm:grid sm:grid-cols-[5rem_1fr] sm:items-center">
            <p className="text-lg font-semibold text-primary">{t(lesson.time)}</p>
            <CardTitle>{t(lesson.title)}</CardTitle>
          </CardHeader>
          <CardContent className="sm:pl-[7rem]">
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              {lesson.steps.map((step) => (
                <li key={step}>{t(step)}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ))}

      <Card id="thirty" className="scroll-mt-20">
        <CardHeader className="sm:grid sm:grid-cols-[5rem_1fr] sm:items-center">
          <p className="text-lg font-semibold text-primary">{t('30分')}</p>
          <CardTitle>{t('自分のShape型Faceを組み込む')}</CardTitle>
        </CardHeader>
        <CardContent className="sm:pl-[7rem]">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>
              <a className="text-primary underline" href="../face-editor/">
                {t('Shape顔エディタ')}
              </a>
              {t('でFace領域、左右の目、まぶた、口を調整します。')}
            </li>
            <li>{t('プレビュー上で目と口をドラッグし、配置を確認します。')}</li>
            <li>{t('「MODで使う」または「変更を反映」を押し、アセット欄の「使用中」を確認します。')}</li>
            <li>
              {t('生成コードに')}
              <code>FaceBase.template</code>
              {t('と')}
              <code>robot.ui.setFace</code>
              {t('が含まれることを確認します。')}
            </li>
            <li>{t('ビルドしてシミュレーターでShape型Faceの表示を確認します。')}</li>
            <li>
              {t('保存ボタンから編集用の')}
              <code>.stackchan-blocks.json</code>
              {t('を保存します。')}
            </li>
            <li>
              {t('必要に応じて実行用の')}
              <code>.xsa</code>
              {t('も保存し、二つの成果物を分けて管理します。')}
            </li>
          </ol>
        </CardContent>
      </Card>

      <Alert>
        <LifeBuoy />
        <AlertTitle>{t('失敗から戻す')}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{t('プロジェクトは編集のたびにブラウザーへ自動保存されます。')}</p>
          <p>{t('実機書き込みは互換性を検証し、書き込み後の内容を読み戻して確認します。')}</p>
          <p>{t('書き込んだMODを起動したくない場合は「実機のMODを削除」を使います。')}</p>
        </AlertDescription>
      </Alert>

      <section className="rounded-xl border-l-4 border-primary bg-card p-5">
        <h2 className="font-semibold">{t('コードによるMOD開発へ移る')}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('生成コードタブの')}
          <code>mod.js</code>
          {t('は、通常のMODと同じ')}
          <code>onContextCreated(robot)</code>
          {t('を公開します。')}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('生成コードを直接変更してもBlocklyへは逆変換されないため、元のプロジェクトファイルも保持してください。')}
        </p>
      </section>
    </div>
  )
}
