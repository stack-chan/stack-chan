export class NetworkService {
  close() {}
  connect(onConnected?: () => void, _onError?: (message: string) => void) {
    onConnected?.()
  }
  scanAndConnect(onConnected?: () => void, _onError?: (message: string) => void) {
    onConnected?.()
  }
}
