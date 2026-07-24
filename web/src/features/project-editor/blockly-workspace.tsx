import * as Blockly from 'blockly'
import 'blockly/blocks'
import { javascriptGenerator, Order } from 'blockly/javascript'
import { useEffect, useRef } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { type Locale } from '@/lib/i18n/catalogs'
import { setLocale as setLegacyLocale } from '../../../i18n.mjs'
import { blocklyMessagesFor } from '../../../editor/blockly-locale.mjs'
import {
  defineStackchanBlocks,
  generateModSource,
  localizedToolbox,
  registerStackchanBlocks,
} from '../../../editor/blocks.mjs'
import { toolboxForTarget } from '../../../editor/capabilities.mjs'

export type BlocklyWorkspaceSnapshot = {
  workspace: Record<string, unknown>
  source: string
  generationError?: string
}

export type BlocklyWorkspaceController = {
  load: (workspace: Record<string, unknown>) => void
  clear: () => void
  focusBlock: (blockId: string) => void
  snapshot: () => BlocklyWorkspaceSnapshot
  setTarget: (target: string) => void
}

export function BlocklyWorkspace({
  initialWorkspace,
  target,
  locale,
  onChange,
  onReady,
}: {
  initialWorkspace: Record<string, unknown>
  target: string
  locale: Locale
  onChange: (snapshot: BlocklyWorkspaceSnapshot) => void
  onReady: (controller: BlocklyWorkspaceController | null) => void
}) {
  const { t } = useI18n()
  const hostRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const targetRef = useRef(target)
  const initialWorkspaceRef = useRef(initialWorkspace)
  const controllerRef = useRef<BlocklyWorkspaceController | null>(null)
  const blocksRegisteredRef = useRef(false)
  onChangeRef.current = onChange
  onReadyRef.current = onReady
  targetRef.current = target
  initialWorkspaceRef.current = initialWorkspace

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let active = true
    let workspace: Blockly.WorkspaceSvg | undefined
    let resizeObserver: ResizeObserver | undefined

    const initialize = async () => {
      await setLegacyLocale(locale)
      if (!active) return
      Blockly.setLocale(blocklyMessagesFor(locale))
      if (blocksRegisteredRef.current) {
        defineStackchanBlocks(Blockly)
      } else {
        registerStackchanBlocks(Blockly, javascriptGenerator, Order)
        blocksRegisteredRef.current = true
      }
      const toolbox = toolboxForTarget(localizedToolbox(), targetRef.current)
      workspace = Blockly.inject(host, {
        toolbox,
        renderer: 'zelos',
        grid: { spacing: 24, length: 2, colour: '#cbd5e1', snap: true },
        zoom: { controls: true, wheel: true, startScale: 0.9 },
        trashcan: true,
      })

      const snapshot = (): BlocklyWorkspaceSnapshot => {
        const state = Blockly.serialization.workspaces.save(workspace!) as Record<string, unknown>
        try {
          return { workspace: state, source: generateModSource(javascriptGenerator, workspace) }
        } catch (error) {
          return {
            workspace: state,
            source: '',
            generationError: String(error instanceof Error ? error.message : error),
          }
        }
      }
      const emit = () => onChangeRef.current(snapshot())
      const load = (state: Record<string, unknown>) => {
        Blockly.Events.disable()
        try {
          workspace!.clear()
          Blockly.serialization.workspaces.load(state, workspace!)
        } finally {
          Blockly.Events.enable()
        }
        emit()
      }
      const controller: BlocklyWorkspaceController = {
        load,
        clear: () => {
          workspace!.clear()
          emit()
        },
        focusBlock: (blockId) => {
          const block = workspace!.getBlockById(blockId)
          if (!block) return
          workspace!.centerOnBlock(block.id)
          block.select()
        },
        snapshot,
        setTarget: (nextTarget) => {
          workspace!.updateToolbox(toolboxForTarget(localizedToolbox(), nextTarget))
          emit()
        },
      }

      load(initialWorkspaceRef.current)
      workspace.addChangeListener((event) => {
        if (event.isUiEvent) return
        emit()
      })
      resizeObserver = new ResizeObserver(() => Blockly.svgResize(workspace!))
      resizeObserver.observe(host)
      controllerRef.current = controller
      onReadyRef.current(controller)
    }

    void initialize()
    return () => {
      active = false
      resizeObserver?.disconnect()
      controllerRef.current = null
      onReadyRef.current(null)
      workspace?.dispose()
    }
  }, [locale])

  useEffect(() => {
    targetRef.current = target
    controllerRef.current?.setTarget(target)
  }, [target])

  return (
    <div
      ref={hostRef}
      className="h-full min-h-[34rem] w-full overflow-hidden rounded-xl border bg-card"
      aria-label={t('Blocklyワークスペース')}
    />
  )
}
