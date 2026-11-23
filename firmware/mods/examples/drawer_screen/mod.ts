import { defineMod } from 'mod-kit'
import { Container, Label } from 'piu/MC'
import Timer from 'timer'

const drawerKey = 'drawer-screen'
const style = new Style({ font: 'k8x12-12', color: '#111111', horizontal: 'center', vertical: 'middle' })
const screenSkin = new Skin({ fill: '#ffffff' })
const buttonSkin = new Skin({ fill: '#dddddd' })

function button(label: string, top: number, onTap: () => void): Container {
  return new Container(null, {
    left: 24,
    right: 24,
    top,
    height: 44,
    active: true,
    skin: buttonSkin,
    Behavior: class extends Behavior {
      onTouchEnded() {
        onTap()
      }
    },
    contents: [new Label(null, { left: 0, right: 0, top: 0, bottom: 0, string: label, style })],
  })
}

export const { onContextCreated, onClose } = defineMod({
  setup({ ui }, _option, scope) {
    let closeScreen: (() => void) | undefined
    ui.drawer.addDrawerButton({
      key: drawerKey,
      label: 'Message screen',
      callback: () => {
        if (closeScreen) return
        let timer: ReturnType<typeof Timer.set> | undefined
        const clearMessage = () => {
          if (timer === undefined) return
          Timer.clear(timer)
          timer = undefined
        }
        const message = new Label(null, { left: 0, right: 0, top: 74, height: 40, string: 'Ready', style })
        const screen = new Container(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          skin: screenSkin,
          contents: [
            button('Back', 4, () => closeScreen?.()),
            message,
            button('Show message', 124, () => {
              clearMessage()
              message.string = 'Hello!'
              timer = Timer.set(() => {
                timer = undefined
                message.string = 'Ready'
              }, 1500)
            }),
          ],
        })

        ui.closeDrawer()
        let closed = false
        const close = ui.setMain(screen, {
          onClose() {
            closed = true
            clearMessage()
            closeScreen = undefined
          },
        })
        if (!closed) closeScreen = close
      },
    })
    scope.own(() => {
      ui.drawer.removeDrawerButton(drawerKey)
      closeScreen?.()
    })
  },
})
