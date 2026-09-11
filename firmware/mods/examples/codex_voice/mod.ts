import { defineApp } from 'stackchan'
import { conversation, type RemoteConversation } from 'stackchan/extensions/conversation'
import { input } from 'stackchan/extensions/input'
import { ui } from 'stackchan/extensions/ui'

export default defineApp({
  setup(app) {
    let remote: RemoteConversation | undefined
    const active = () => !!remote && remote.state !== 'standby' && remote.state !== 'blocked'
    const activate = () => {
      if (remote) return remote
      const connection = conversation(app).remote()
      remote = connection
      connection.onState((state, error) => {
        toggle.setValue(active())
        app.ui.showBalloon(error ?? state)
      })
      connection.onTransport((state) => {
        if (state !== 'ready') app.ui.showBalloon(`USB: ${state}`)
      })
      return connection
    }
    const request = (enabled: boolean) => {
      try {
        const connection = activate()
        const id = enabled ? connection.requestStart() : connection.requestStop()
        app.ui.showBalloon(`要求を受け付けました: ${id}`)
      } catch (error) {
        app.ui.showBalloon(String(error))
      }
      // A successful menu handler would otherwise commit the requested value.
      toggle.setValue(active())
    }
    const toggle = ui(app).addToggle({ id: 'remote', label: 'USB 音声会話', value: false }, request)
    if (app.capabilities.get('input.headTouch').availability !== 'unavailable')
      input(app).onHeadTouch((event) => {
        if (event.gesture === 'forwardSwipe') request(true)
        if (event.gesture === 'backwardSwipe') request(false)
      })
    // Activation retains the USB approval workflow; request IDs acknowledge acceptance.
    try {
      app.ui.showBalloon(`USB: ${activate().transport}`)
    } catch (error) {
      app.ui.showBalloon(String(error))
    }
  },
})
