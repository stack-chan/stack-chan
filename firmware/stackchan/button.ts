import { Application, Color, Container, Content } from 'piu/MC'

// TODO: separate into modules
export class ButtonBehavior extends Behavior {
  onButtonChange: (string, boolean) => unknown
  onCreate(_, { onButtonChange }) {
    this.onButtonChange = onButtonChange
  }
  onTouchBegan(content, id, x, y, tick) {
    trace(`button ${content.name} touch began: ${id}, (${x}, ${y}), ${tick}\n`)
    this.onButtonChange(content.name, true)
  }
  onTouchEnded(content, id, x, y, tick) {
    trace(`button ${content.name} touch ended: ${id}, (${x}, ${y}), ${tick}\n`)
    this.onButtonChange(content.name, false)
  }
}

export const Button = Content.template(({ name, color = 'white', onButtonChange }) => ({
  name,
  active: true,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  skin: new Skin({ fill: color }),
  Behavior: ButtonBehavior
}))
