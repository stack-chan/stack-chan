import { type Locale } from '@/lib/i18n/catalogs'

type Text = readonly [string, string, string]
type Topic = { id: string; title: Text; summary: Text; steps?: Text[]; prompts?: Text[]; href?: string }

const topics: Topic[] = [
  {
    id: 'start',
    title: ['はじめて使う', 'Getting started', '初次使用'],
    summary: [
      '実機がなくても、ブロックエディタと顔エディタを試せます。初めての方はここから読み、以降は目的に合う項目を開いてください。',
      'Try the block and face editors without a robot. Start here, then open the topic for your task.',
      '没有机器人也能使用积木和面部编辑器。请先阅读本节，再选择所需主题。',
    ],
    steps: [
      [
        'ブロックエディタでサンプルを選び、ビルドしてシミュレーターで実行します。',
        'Choose a sample in the block editor, build it, and run it in the simulator.',
        '在积木编辑器中选择示例，构建后在模拟器中运行。',
      ],
      [
        '実機で使う場合は、対応するファームウェアを書き込み、本体の「設定」画面を開いて BLE で接続します。',
        'For a physical robot, install matching firmware, open Settings on the robot, then connect using BLE.',
        '使用实机时，请安装对应固件，打开机器人的设置画面，然后通过 BLE 连接。',
      ],
    ],
    href: 'editor/',
  },
  {
    id: 'webmcp',
    title: ['AI と一緒に操作する', 'Work with an AI agent', '与 AI 协作'],
    summary: [
      'WebMCP に対応したブラウザの AI は、開いているページの内容を取得し、同じ画面を編集できます。AI との会話には、対応するブラウザ機能や拡張機能を使います。',
      'A WebMCP-capable browser agent can read and edit the page you have open. Use a compatible browser agent or extension for the conversation.',
      '支持 WebMCP 的浏览器 AI 可以读取和编辑当前页面。请使用兼容的浏览器功能或扩展与 AI 对话。',
    ],
    steps: [
      [
        'Chrome では chrome://flags/#enable-webmcp-testing を有効にし、ブラウザを再起動します。WebMCP は試験的な機能で、対応状況はブラウザによって異なります。',
        'In Chrome, enable chrome://flags/#enable-webmcp-testing and relaunch. WebMCP is experimental and availability depends on your browser.',
        '在 Chrome 中启用 chrome://flags/#enable-webmcp-testing 并重启浏览器。WebMCP 是实验性功能，支持情况因浏览器而异。',
      ],
      [
        '操作したいエディタや設定ページを開き、AI に変更したい内容を伝えます。ページを移動した後は、移動先の状態を取得して作業を続けます。',
        'Open the editor or settings page and tell the agent what to change. After navigation, read the new page state before continuing.',
        '打开所需编辑器或设置页面，告诉 AI 要修改的内容。跳转后，先读取新页面状态，再继续操作。',
      ],
      [
        'デバイス選択や書き込みの確認が表示されたら、画面で内容を確認して続行します。',
        'When device selection or a write confirmation appears, review it on screen and continue.',
        '出现设备选择或写入确认时，请在画面上确认后继续。',
      ],
    ],
    prompts: [['このページでできることを教えて。', 'Explain what I can do on this page.', '告诉我这个页面能做什么。']],
  },
  {
    id: 'editor',
    title: ['ブロックから MOD を作る', 'Build a MOD with blocks', '用积木制作 MOD'],
    summary: [
      'MOD は、ｽﾀｯｸﾁｬﾝに追加するアプリです。「スタートしたとき」などのイベントに処理を接続します。',
      'A MOD is an application added to Stack-chan. Connect actions to events such as “when started”.',
      'MOD 是添加到机器人的应用。将动作连接到“启动时”等事件。',
    ],
    steps: [
      [
        '対象機種を選び、サンプルの表情やセリフを変更します。診断にエラーがあれば、該当するブロックを修正します。',
        'Choose a target and edit the sample’s expression or dialogue. Resolve any errors shown in diagnostics.',
        '选择目标机型，修改示例的表情或台词，并修复诊断中的错误。',
      ],
      [
        'ビルド後に「シミュレーターで実行」を押します。A/B/C ボタンで反応を試し、終わったら閉じます。',
        'After building, run in the simulator. Try the A/B/C buttons, then close the simulator.',
        '构建后在模拟器中运行，使用 A/B/C 按钮测试反应，结束后关闭。',
      ],
      [
        '実機へ書き込むときは USB デバイスを選び、対象とファームウェアを確認します。書き込み後は読み戻し検証の結果を確認します。',
        'To install on a robot, select a USB device and check the target and firmware. Check the readback verification result after installation.',
        '写入实机时，选择 USB 设备并确认机型与固件。写入后检查回读验证结果。',
      ],
    ],
    prompts: [
      [
        'ボタン A を押すと笑顔で「こんにちは」と表示する MOD を作って、シミュレーターで試して。',
        'Create a MOD that smiles and displays “Hello” when button A is pressed, then test it in the simulator.',
        '制作按下 A 按钮时微笑并显示“你好”的 MOD，然后在模拟器中测试。',
      ],
    ],
    href: 'editor/',
  },
  {
    id: 'face-editor',
    title: ['自分の顔を作って使う', 'Design and use a face', '设计并使用面部'],
    summary: [
      'Shape 顔は目や口の形と位置で作ります。編集中の顔はプレビューと下書きに反映されます。',
      'A Shape face is built from eye and mouth shapes and positions. Edits update the preview and draft.',
      'Shape 面部由眼睛和嘴巴的形状、位置组成。编辑会更新预览和草稿。',
    ],
    steps: [
      [
        '左右の目、口、色、初期表情を調整します。まぶたの大きさは目に合わせて自動調整されます。',
        'Adjust the eyes, mouth, colors, and initial expression. Eyelids resize to fit the eyes.',
        '调整眼睛、嘴巴、颜色和初始表情。眼睑大小会自动适应眼睛。',
      ],
      [
        '「MODで使う」を押してブロックエディタへ渡し、ビルドして表示を確認します。既存の MOD から開いた場合は「変更を反映」で元の顔を更新します。',
        'Use “Use in MOD” to transfer the face to the block editor, then build and preview it. When editing a face from a MOD, “Apply changes” updates the original asset.',
        '点击“在 MOD 中使用”传送到积木编辑器，构建后预览。从现有 MOD 打开时，使用“应用更改”更新原面部素材。',
      ],
    ],
    prompts: [
      [
        '目を少し大きくして、青い背景に合う笑顔にして。',
        'Make the eyes a little larger and create a happy face for a blue background.',
        '把眼睛稍微放大，制作适合蓝色背景的笑脸。',
      ],
    ],
    href: 'face-editor/',
  },
  {
    id: 'preference',
    title: ['本体の設定を変更する', 'Change robot settings', '更改机器人设置'],
    summary: [
      '本体の設定画面を開いてから「BLEで接続」を押します。設定ページでは Wi-Fi、サーボ、音声、AI などの項目を変更します。',
      'Open Settings on the robot, then choose “Connect via BLE”. Configure Wi-Fi, servos, speech, AI, and other settings here.',
      '先打开机器人的设置画面，再点击“通过 BLE 连接”。可修改 Wi-Fi、舵机、语音、AI 等设置。',
    ],
    steps: [
      [
        '変更した項目を確認して「設定を保存」を押します。送信結果と、本体から受信した状態を確認してください。',
        'Review your changes and save. Check both the send result and the values received from the robot.',
        '确认更改后保存，并检查发送结果及从机器人接收的状态。',
      ],
      [
        'パスワードやトークンは AI への読み出し結果には含まれません。変更できない項目は、本体側で固定されています。',
        'Passwords and tokens are omitted from agent read results. Read-only fields are fixed by the robot.',
        'AI 的读取结果不包含密码或令牌。只读项目由机器人固定。',
      ],
      [
        'Wi-Fi 設定を消去すると、次回はオフラインで起動します。消去前に確認画面が表示されます。',
        'Clearing Wi-Fi settings makes the robot start offline next time. A confirmation appears before clearing.',
        '清除 Wi-Fi 设置后，下次将离线启动。清除前会显示确认画面。',
      ],
    ],
    prompts: [['音量を 0.3 に変更して保存して。', 'Set the volume to 0.3 and save.', '将音量设为 0.3 并保存。']],
    href: 'preference/',
  },
  {
    id: 'flash',
    title: ['ファームウェアを書き込む', 'Install firmware', '安装固件'],
    summary: [
      '対応ボードを選び、USB で接続してファームウェアを書き込みます。本体設定とインストール済み MOD が消去されるため、必要な内容を先に控えてください。',
      'Select your board and install firmware over USB. This erases robot settings and the installed MOD; keep the information you need first.',
      '选择开发板，通过 USB 安装固件。这会清除机器人设置和已安装的 MOD，请先保存所需信息。',
    ],
    href: 'flash/',
  },
  {
    id: 'mod-gallery',
    title: ['公開されている MOD を試す', 'Try published MODs', '试用已发布的 MOD'],
    summary: [
      'MOD Gallery で対応機種と必要な機能を確認します。対応する MOD はシミュレーターで試せます。ブロックの編集データがある場合は「ブロックで開く」から変更できます。',
      'Check targets and requirements in MOD Gallery. Supported MODs can run in the simulator; those with block projects can be opened in the block editor.',
      '在 MOD Gallery 中检查支持机型和所需功能。兼容 MOD 可在模拟器中运行；有积木工程的 MOD 可在积木编辑器中打开。',
    ],
    href: 'mod-gallery/',
  },
  {
    id: 'simulator',
    title: ['シミュレーターで動きを確認する', 'Check behavior in the simulator', '在模拟器中检查行为'],
    summary: [
      'WASM はブラウザで実行するファームウェアです。シミュレーターに MOD を読み込み、画面やボタンの反応を確認できます。実機の配線やセンサーの動作は実機でも確認してください。',
      'WASM runs firmware in the browser. Load a MOD to check its display and button responses. Verify physical wiring and sensors on the robot as well.',
      'WASM 在浏览器中运行固件。加载 MOD 以检查显示和按钮反应。实机接线及传感器仍需在机器人上验证。',
    ],
    href: 'simulator/',
  },
  {
    id: 'mediapipe',
    title: ['顔や手を追いかけさせる', 'Track a face or hand', '追踪人脸或手部'],
    summary: [
      'MediaPipe BLE 追従ページから対応 MOD の案内を開き、CoreS3 にインストールします。カメラと BLE に接続して追従を開始し、終了時に停止します。',
      'Follow the MOD link on the MediaPipe BLE tracking page and install it on CoreS3. Connect the camera and BLE to start tracking; stop when finished.',
      '从 MediaPipe BLE 追踪页面打开对应 MOD 并安装到 CoreS3。连接摄像头和 BLE 开始追踪，结束时停止。',
    ],
    href: 'mediapipe/',
  },
  {
    id: 'files',
    title: ['編集データを保存する', 'Save editable files', '保存可编辑文件'],
    summary: [
      'ブロックの編集用ファイルは .stackchan-blocks.json、顔は .stackchan-face.json、実行用 MOD は .xsa です。ブラウザの自動保存は同じブラウザ内に残ります。別の環境へ移すときは編集用ファイルを書き出してください。',
      'Editable block projects use .stackchan-blocks.json, faces use .stackchan-face.json, and executable MODs use .xsa. Autosaves stay in this browser; export editable files to move to another environment.',
      '积木工程使用 .stackchan-blocks.json，面部使用 .stackchan-face.json，可执行 MOD 使用 .xsa。自动保存仅保留在当前浏览器中，转移环境时请导出可编辑文件。',
    ],
  },
  {
    id: 'glossary',
    title: ['用語を確認する', 'Glossary', '术语表'],
    summary: [
      'MOD は追加アプリ、ファームウェアは本体の基本プログラムです。BLE は近距離の無線通信、WASM はブラウザ内でプログラムを動かす形式です。WebMCP はページが AI に操作を提供する仕組みを指します。',
      'A MOD is an add-on app; firmware is the robot’s base program. BLE is short-range wireless communication. WASM runs programs in the browser. WebMCP lets a page provide tools to an AI agent.',
      'MOD 是扩展应用，固件是机器人的基础程序。BLE 是短距离无线通信，WASM 是在浏览器中运行程序的格式。WebMCP 让页面向 AI 提供操作工具。',
    ],
  },
  {
    id: 'troubleshooting',
    title: ['操作が進まないとき', 'Troubleshooting', '操作无法继续时'],
    summary: [
      '編集の競合が表示されたら、現在の状態を読み直して変更します。ビルドのエラーは診断とログを確認し、修正後に再ビルドしてください。',
      'If an edit conflict occurs, read the current state before editing again. Check diagnostics and logs for build errors, then rebuild after fixing them.',
      '发生编辑冲突时，重新读取当前状态后再修改。构建出错时检查诊断和日志，修复后重新构建。',
    ],
    steps: [
      [
        'BLE 接続が見つからない場合は、本体が設定画面になっているか確認します。USB 操作が失敗した場合は、ほかのアプリがポートを使っていないか確認します。',
        'If BLE cannot find the robot, check that its Settings screen is open. If USB fails, check whether another app is using the port.',
        'BLE 找不到机器人时，确认机器人已打开设置画面。USB 操作失败时，检查端口是否被其他应用占用。',
      ],
      [
        '解決しない場合は GitHub Issues に、対象機種、ブラウザ、再現手順、秘密情報を除いたエラー内容を添えて報告してください。',
        'If the issue persists, report the target, browser, reproduction steps, and errors without secrets in GitHub Issues.',
        '如果问题持续，请在 GitHub Issues 中报告机型、浏览器、复现步骤及不含敏感信息的错误内容。',
      ],
    ],
    href: 'https://github.com/stack-chan/stack-chan/issues',
  },
]

export function getGuides(locale: Locale) {
  const index = locale === 'en' ? 1 : locale === 'zh-CN' ? 2 : 0
  return topics.map((topic) => ({
    ...topic,
    title: topic.title[index],
    summary: topic.summary[index],
    steps: topic.steps?.map((text) => text[index]) ?? [],
    prompts: topic.prompts?.map((text) => text[index]) ?? [],
  }))
}
