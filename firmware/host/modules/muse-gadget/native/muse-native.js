import MuseNativeTransport from 'muse-native-transport'

const construct = native('xs_muse_constructor')
export default class MuseNative extends MuseNativeTransport {
  constructor(options, onEvent) {
    super(onEvent)
    construct.call(this, options.host, options.vmId, options.token, options.appId ?? '')
  }
}
