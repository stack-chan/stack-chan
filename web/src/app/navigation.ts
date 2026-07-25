import {
  Blocks,
  Box,
  CircleHelp,
  Cpu,
  Home,
  ScanFace,
  SlidersHorizontal,
  Smile,
  Store,
  type LucideIcon,
} from 'lucide-react'

export type NavigationId =
  'home' | 'flash' | 'preference' | 'mod-gallery' | 'mediapipe' | 'simulator' | 'editor' | 'face-editor' | 'tutorial'

export type NavigationItem = {
  id: NavigationId
  href: string
  label: string
  description: string
  icon: LucideIcon
}

export const TOOL_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { id: 'home', href: '', label: 'ホーム', description: 'Webツールの一覧', icon: Home },
  {
    id: 'flash',
    href: 'flash/',
    label: 'ファームウェア書き込み',
    description: 'USBで対応ボードへ書き込む',
    icon: Cpu,
  },
  {
    id: 'preference',
    href: 'preference/',
    label: '設定',
    description: 'BLEで本体の設定を変更する',
    icon: SlidersHorizontal,
  },
  {
    id: 'mod-gallery',
    href: 'mod-gallery/',
    label: 'MOD Gallery',
    description: '公開済みMODを試して編集する',
    icon: Store,
  },
  {
    id: 'mediapipe',
    href: 'mediapipe/',
    label: 'MediaPipe BLE追従',
    description: '顔と手の動きをBLEで送る',
    icon: ScanFace,
  },
  {
    id: 'simulator',
    href: 'simulator/',
    label: 'シミュレーター',
    description: 'WASMと3Dモデルを実行する',
    icon: Box,
  },
  {
    id: 'editor',
    href: 'editor/',
    label: 'ブロックエディタ',
    description: 'BlocklyからMODを作成する',
    icon: Blocks,
  },
  {
    id: 'face-editor',
    href: 'face-editor/',
    label: 'Shape顔エディタ',
    description: 'Shape型Faceを設計する',
    icon: Smile,
  },
]

export const GUIDE_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    id: 'tutorial',
    href: 'editor/tutorial.html',
    label: 'ブロックエディタ チュートリアル',
    description: '作成から実行までの手順',
    icon: CircleHelp,
  },
]
