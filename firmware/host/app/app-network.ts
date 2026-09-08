import { AppConnection, type AppServiceScope } from 'app-service-scope'
import type { ConnectivityCapability } from 'capabilities'
import type { JsonValue as WireJson } from 'local-peer-types'
import Modules from 'modules'
import { StackchanError } from 'stackchan/errors'
import type { AppNetwork, PeerConnection } from 'stackchan/extensions/network'

export function createAppNetwork(scope: AppServiceScope, connectivity: ConnectivityCapability): AppNetwork {
  const platform = (): AppNetwork => {
    if (!Modules.has('app-network-native'))
      throw new StackchanError('UNSUPPORTED', 'Native networking is unavailable on this target')
    return (Modules.importNow('app-network-native') as (scope: AppServiceScope) => AppNetwork)(scope)
  }
  return {
    ready: (options) =>
      scope.run(async ({ signal }) => {
        if (!connectivity.network) throw new StackchanError('UNSUPPORTED', 'Wi-Fi is unavailable')
        const result = await connectivity.network.ready
        signal.throwIfCancelled()
        if (result.status !== 'connected') throw new StackchanError('CONFIG', result.reason)
      }, options?.signal),
    address: () => scope.call(() => platform().address()),
    request: (request, options) =>
      scope.run((task) => platform().request(request, { signal: task.signal }), options?.signal),
    stream: (request) => scope.call(() => platform().stream(request)),
    connect: (options) => scope.call(() => platform().connect(options)),
    serve: (options) => scope.call(() => platform().serve(options)),
    serveTools: (options) => scope.call(() => platform().serveTools(options)),
    listenStk: (options) => scope.call(() => platform().listenStk(options)),
    beacon: (options) => scope.call(() => platform().beacon(options)),
    advertiseService: (options) => scope.call(() => platform().advertiseService(options)),
    discoverServices: (options) => scope.call(() => platform().discoverServices(options)),
    openPeer: (options) =>
      scope.run(async () => {
        if (!connectivity.localPeer) throw new StackchanError('UNSUPPORTED', 'Local peer transport is unavailable')
        const owner = new AppConnection(scope)
        try {
          const session = await connectivity.localPeer.open(options)
          owner.own(() => session.close())
          return {
            close: owner.close,
            discover: (request) => owner.run(() => session.discover(request), request?.signal),
            send: (id, type, payload, request) =>
              owner.run(async () => {
                await session.send(id, type, payload as WireJson)
              }, request?.signal),
            broadcast: (type, payload, request) =>
              owner.run(async () => {
                await session.broadcast(type, payload as WireJson)
              }, request?.signal),
            onMessage: (type, handler) =>
              owner.call(() => {
                const off = session.subscribe(type, owner.event(handler))
                const release = owner.own(off)
                return () => {
                  release()
                  off()
                }
              }),
          } satisfies PeerConnection
        } catch (error) {
          await owner.close()
          throw error
        }
      }),
  }
}
