import { useEffect, useRef } from 'react'
import { AppShell } from '@/app/app-shell'
import { mountApp } from '@/app/mount'
import { mountEditor } from '../../avatar-dsl/editor.mjs'
import '@/styles/globals.css'
import '../../avatar-dsl/style.css'

function AvatarEditor() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.title = '顔 DSL エディタ | Stack-chan'
    return mountEditor(root.current!)
  }, [])
  return (
    <AppShell current="avatar-dsl" surfaceName="顔 DSL エディタ" rootHref="../">
      <div ref={root} className="avatar-studio page-container py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-heading">顔をコードで描く</h1>
            <p className="page-lead">実機と共通の C / WASM で描画します。</p>
          </div>
          <p id="bridge-status" role="status">
            WebMCP 確認中
          </p>
        </div>
        <div className="studio-grid">
          <section aria-label="DSL エディタ">
            <label>
              プリセット{' '}
              <select id="sample" defaultValue="default">
                <option value="default">Default</option>
                <option value="aokko">Aokko</option>
                <option value="omega">Omega mouth</option>
                <option value="minimal">Minimal</option>
                <option value="rounded">Rounded eyes</option>
                <option value="mono">Mono iris</option>
                <option value="compound">Compound iris</option>
                <option value="sensor">Mono C SENSOR</option>
              </select>
            </label>
            <div className="studio-toolbar">
              <button id="load">DSL を開く</button>
              <button id="undo" disabled>
                変更を戻す
              </button>
              <button id="validate">検証・描画</button>
            </div>
            <input id="file" type="file" accept=".avdsl,text/plain" hidden />
            <label className="sr-only" htmlFor="source">
              Avatar DSL ソースコード
            </label>
            <div className="source-wrap">
              <pre id="line-numbers" aria-hidden="true">
                1
              </pre>
              <textarea
                id="source"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                wrap="off"
                aria-describedby="diagnostic"
              />
            </div>
            <p id="diagnostic" role="status" aria-live="polite">
              C / WASM を初期化中
            </p>
            <div className="studio-toolbar">
              <button id="download">DSL を保存</button>
              <button id="bytecode" disabled>
                AVBC を保存
              </button>
              <small id="revision">Revision 0</small>
            </div>
          </section>
          <section aria-label="ライブプレビュー">
            <div className="canvas-stage">
              <canvas id="preview" width="320" height="240" aria-label="C WASM 顔プレビュー" />
            </div>
            <p id="render-status">検証するとプレビューを更新します。</p>
            <div className="studio-controls">
              <label>
                目の開き
                <input id="eye" type="range" min="0" max="1" step="0.01" defaultValue="1" />
              </label>
              <label>
                口の開き
                <input id="mouth" type="range" min="0" max="1" step="0.05" defaultValue="0" />
              </label>
              <label>
                視線・左右
                <input id="gaze" type="range" min="-1" max="1" step="0.1" defaultValue="0" />
              </label>
              <label>
                呼吸
                <input id="breath" type="range" min="-1" max="1" step="0.1" defaultValue="1" />
              </label>
              <label>
                表情
                <select id="expression" defaultValue="0">
                  <option value="0">Neutral</option>
                  <option value="1">Happy</option>
                  <option value="2">Sad</option>
                  <option value="3">Angry</option>
                  <option value="4">Doubt</option>
                  <option value="5">Sleepy</option>
                </select>
              </label>
            </div>
            <div className="studio-device">
              <h2>Stack-chan に転送</h2>
              <p>対応する M5StackChan CoreS3 の MOD を置き換えます。</p>
              <button id="transfer" disabled>
                転送を準備
              </button>
              <p id="transfer-status" role="status">
                転送には Web Serial 対応ブラウザが必要です。
              </p>
            </div>
            <details>
              <summary>DSL ガイド・上限</summary>
              <p id="guide" />
            </details>
          </section>
        </div>
        <dialog id="confirmation" aria-labelledby="confirmation-title">
          <h2 id="confirmation-title">実機転送の確認</h2>
          <p>表示中の顔を含む MOD を転送し、現在の MOD を置き換えます。</p>
          <p id="transfer-snapshot" />
          <label>
            <input id="compatible-host" type="checkbox" /> native Avatar DSL と strict group clip に対応する host
            を導入済みです。
          </label>
          <p>確認後に USB ポートを選択します。選択した機器だけに書き込みます。</p>
          <div className="studio-toolbar">
            <button id="cancel-transfer">キャンセル</button>
            <button id="confirm-transfer" disabled>
              確認して USB 転送
            </button>
          </div>
        </dialog>
      </div>
    </AppShell>
  )
}
mountApp(<AvatarEditor />)
