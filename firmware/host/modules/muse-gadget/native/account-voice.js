import MuseNativeTransport from 'muse-native-transport'

const construct = native('xs_muse_account_constructor')
export default class MuseAccountNative extends MuseNativeTransport {
  constructor(account, onEvent, appId = '') {
    super(onEvent)
    construct.call(this, account, appId)
  }
}
