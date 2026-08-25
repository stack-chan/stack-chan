import Flash from 'flash'
import { localize } from 'localization'
import { type ModFlash, validateXsaArchive, writeAndVerifyXsaArchive } from 'mod-installer'
import type { Application as PiuApplication, Content as PiuContent } from 'piu/MC'
import { Column, Container, Label, Scroller } from 'piu/MC'
import SDCard from 'stackchan-sdcard'
import Timer from 'timer'
import { ActionButton, ScreenHeader } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

const runtime = globalThis as typeof globalThis & { System: { restart(): void } }

export function startModManager(
  application: PiuApplication,
  restart: () => void = () => runtime.System.restart(),
): Promise<'back'> {
  return new Promise((resolve) => {
    const styles = uiStyles()
    let partitionIntact = true

    const mount = (contents: PiuContent[]) => {
      application.empty()
      application.add(
        new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          skin: styles.screen,
          contents,
        }),
      )
    }
    const finish = () => {
      if (partitionIntact) resolve('back')
    }
    const messageLabel = (message: string) =>
      new Label(null, {
        left: 12,
        right: 12,
        top: UI.headerHeight + 20,
        bottom: UI.touchTarget + 20,
        string: message,
        style: styles.bodyMuted,
      })

    const showError = (message: string, onBack: () => void, onRetry: () => void) => {
      const actions: PiuContent[] = [
        new ActionButton(
          { name: 'mod:retry', icon: 'retry', label: localize('splash.retry'), onTap: onRetry },
          partitionIntact ? { left: 86, right: 86, bottom: 12 } : { left: 8, width: 148, bottom: 12 },
        ),
      ]
      if (!partitionIntact) {
        actions.push(
          new ActionButton(
            { name: 'mod:restart', icon: 'play', label: localize('mods.restart'), onTap: restart },
            { right: 8, width: 148, bottom: 12 },
          ),
        )
      }
      mount([
        new ScreenHeader({
          title: localize('mods.title'),
          leading: partitionIntact ? 'back' : undefined,
          onLeading: partitionIntact ? onBack : undefined,
        }),
        messageLabel(message),
        ...actions,
      ])
    }

    const showList = () => {
      let names: string[]
      try {
        names = SDCard.list().sort()
      } catch (error) {
        trace(`[mods] SD list failed: ${String(error)}\n`)
        showError(localize('mods.cardError'), finish, showList)
        return
      }
      if (names.length === 0) {
        showError(localize('mods.none'), finish, showList)
        return
      }

      const rows = names.map(
        (name) =>
          new ActionButton(
            { name: `mod:${name}`, icon: 'apps', label: name, onTap: () => showConfirmation(name) },
            { left: 8, right: 8 },
          ),
      )
      mount([
        new ScreenHeader({
          title: localize('mods.title'),
          leading: partitionIntact ? 'back' : undefined,
          onLeading: finish,
        }),
        new Scroller(null, {
          left: 0,
          right: 0,
          top: UI.headerHeight + 8,
          bottom: 8,
          active: true,
          clip: true,
          contents: [new Column(null, { left: 0, right: 0, top: 0, contents: rows })],
        }),
      ])
    }

    const showConfirmation = (name: string) => {
      mount([
        new ScreenHeader({ title: localize('mods.title'), leading: 'back', onLeading: showList }),
        messageLabel(localize('mods.confirm', { name })),
        new ActionButton(
          { name: 'mod:cancel', icon: 'back', label: localize('settings.cancel'), onTap: showList },
          { left: 8, width: 148, bottom: 12 },
        ),
        new ActionButton(
          { name: 'mod:install', icon: 'check', label: localize('mods.install'), onTap: () => install(name) },
          { right: 8, width: 148, bottom: 12 },
        ),
      ])
    }

    const install = (name: string) => {
      mount([new ScreenHeader({ title: localize('mods.title') }), messageLabel(localize('mods.installing'))])
      Timer.set(() => {
        const flash = new Flash('xs') as unknown as ModFlash
        let bytes: Uint8Array
        try {
          // ponytail: buffer one partition-sized XSA for this PoC; stream it when near-limit MODs exhaust heap.
          bytes = validateXsaArchive(SDCard.read(name, flash.byteLength), flash.byteLength, SDCard.xsVersionRange())
        } catch (error) {
          trace(`[mods] ${name} rejected: ${String(error)}\n`)
          showError(localize('mods.rejected'), showList, () => showConfirmation(name))
          return
        }

        partitionIntact = false
        try {
          writeAndVerifyXsaArchive(bytes, flash)
          trace(`[mods] installed ${name}, restarting\n`)
          restart()
        } catch (error) {
          trace(`[mods] ${name} write failed: ${String(error)}\n`)
          showError(localize('mods.writeFailed'), showList, showList)
        }
      }, 0)
    }

    showList()
  })
}

export default startModManager
