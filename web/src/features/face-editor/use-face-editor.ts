import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  cloneFaceAsset,
  generateShapeFace,
  normalizeFaceAsset,
  type FaceAsset,
  type FaceEditContext,
} from '@/features/face-editor/face-model'
import {
  clearFaceEditContext,
  loadFaceDraft,
  loadFaceEditContext,
  saveFaceDraft,
  stageFaceTransfer,
} from '../../../face-editor/face-editor-storage.mjs'

type Status = { message: string; kind?: 'success' | 'error' | 'warning' }

type InitialFace = {
  asset: FaceAsset
  edit: FaceEditContext | null
  status: Status
}

const stageTransfer = stageFaceTransfer as unknown as (asset: FaceAsset, edit: FaceEditContext | null) => unknown

const loadInitialFace = (): InitialFace => {
  const fromProject = new URLSearchParams(location.search).get('face-edit') === 'project'
  if (fromProject) {
    try {
      const transfer = loadFaceEditContext() as { asset: FaceAsset; edit: FaceEditContext | null } | null
      if (!transfer?.edit) throw new TypeError('編集元の情報がありません')
      return {
        asset: normalizeFaceAsset(transfer.asset),
        edit: transfer.edit,
        status: {
          message: `「${transfer.asset.name}」をMODプロジェクトから読み込みました。`,
          kind: 'success',
        },
      }
    } catch (error) {
      try {
        const draft = loadFaceDraft() as FaceAsset | null
        if (draft) {
          return {
            asset: normalizeFaceAsset(draft),
            edit: null,
            status: {
              message: `MODの顔データを読み込めなかったため、下書きを復元しました: ${
                error instanceof Error ? error.message : String(error)
              }`,
              kind: 'error',
            },
          }
        }
      } catch {
        // The edit-context error is more useful than a secondary draft error.
      }
      return {
        asset: normalizeFaceAsset(),
        edit: null,
        status: {
          message: `MODの顔データを読み込めなかったため、標準Faceを開きました: ${
            error instanceof Error ? error.message : String(error)
          }`,
          kind: 'error',
        },
      }
    }
  }

  try {
    clearFaceEditContext()
  } catch {
    // Stale context is ignored for a normal editor launch.
  }
  try {
    const draft = loadFaceDraft() as FaceAsset | null
    if (draft) {
      return {
        asset: normalizeFaceAsset(draft),
        edit: null,
        status: { message: '前回の下書きを復元しました。', kind: 'success' },
      }
    }
  } catch (error) {
    return {
      asset: normalizeFaceAsset(),
      edit: null,
      status: {
        message: `保存された下書きを読み込めなかったため、標準Faceを開きました: ${
          error instanceof Error ? error.message : String(error)
        }`,
        kind: 'error',
      },
    }
  }
  return {
    asset: normalizeFaceAsset(),
    edit: null,
    status: { message: 'Shape型Faceを編集中です。' },
  }
}

export function useFaceEditor() {
  const [initial] = useState(loadInitialFace)
  const [asset, setAsset] = useState(initial.asset)
  const [status, setStatus] = useState<Status>(initial.status)

  useEffect(() => {
    try {
      saveFaceDraft(asset)
    } catch (error) {
      setStatus({
        message: `下書きを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`,
        kind: 'error',
      })
    }
  }, [asset])

  const update = useCallback((mutate: (draft: FaceAsset) => void) => {
    setAsset((current) => {
      const draft = cloneFaceAsset(current)
      mutate(draft)
      return normalizeFaceAsset(draft)
    })
    setStatus({ message: 'Shape型Faceを編集中です。' })
  }, [])

  const replace = useCallback((nextAsset: FaceAsset, message: string) => {
    setAsset(normalizeFaceAsset(nextAsset))
    setStatus({ message, kind: 'success' })
  }, [])

  const reset = useCallback(() => replace(normalizeFaceAsset(), '標準のShape配置へ戻しました。'), [replace])

  const stageForEditor = useCallback(() => {
    try {
      saveFaceDraft(asset)
      stageTransfer(asset, initial.edit)
      setStatus({
        message: 'Shape型Faceを保存しました。ブロックエディタを開きます。',
        kind: 'success',
      })
      location.href = '../editor/?face-asset=staging'
    } catch (error) {
      setStatus({
        message: `ブロックエディタへ顔を渡せませんでした: ${error instanceof Error ? error.message : String(error)}`,
        kind: 'error',
      })
    }
  }, [asset, initial.edit])

  const code = useMemo(
    () => `${generateShapeFace(asset)}

export function onContextCreated(robot) {
  robot.ui.setFace(new _StackchanVisualShapeFace({}))
}`,
    [asset]
  )

  return {
    asset,
    edit: initial.edit,
    status,
    setStatus,
    code,
    update,
    replace,
    reset,
    stageForEditor,
  }
}
