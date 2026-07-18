import {
  isMiniAppImportAllowed,
  prepareExperimentalMiniApps,
  registerExperimentalMiniApps,
} from 'experimental-mini-app-loader'
import { MiniAppRegistry } from 'mini-app'
import { Container } from 'piu/MC'
import { assert, equal } from 'testing/assert'

trace('=== experimental mini-app loader test ===\n')

const definition = {
  id: 'archive.test',
  title: 'Archive Test',
  create: () => new Container(),
}

type CapturedOptions = {
  globals: Record<string, unknown>
  modules: Record<string, unknown>
  resolveHook(specifier: string, referrer: string): string
}
let capturedOptions: CapturedOptions | null = null

class FakeCompartment {
  constructor(options: typeof capturedOptions) {
    capturedOptions = options
  }

  importNow(specifier: string) {
    equal(specifier, 'miniapp', 'loader should import only the miniapp entry module')
    return { default: [definition] }
  }
}

type IntrinsicCompartmentConstructor = new (options: {
  globals: Record<string, unknown>
  modules: Record<string, never>
  resolveHook(specifier: string, referrer: string): string
}) => unknown

type IntrinsicGlobals = { Compartment?: IntrinsicCompartmentConstructor }

const intrinsicCompartment = (globalThis as unknown as IntrinsicGlobals).Compartment
assert(typeof intrinsicCompartment === 'function', 'XS Compartment should be retained by the linker')
const IntrinsicCompartment = intrinsicCompartment as IntrinsicCompartmentConstructor
assert(
  new IntrinsicCompartment({ globals: {}, modules: {}, resolveHook: (specifier) => specifier }),
  'XS Compartment should be constructible',
)

const pack = prepareExperimentalMiniApps({ has: (specifier) => specifier === 'miniapp' }, {
  archive: {},
  Compartment: FakeCompartment as never,
} as never)

assert(pack, 'loader should return a pack when an archive miniapp module is present')
assert(capturedOptions, 'loader should construct a compartment')
const options = capturedOptions as unknown as CapturedOptions
assert(!('Application' in options.globals), 'Application should not be endowed into the mini app compartment')
assert(!('Container' in options.globals), 'Piu constructors should not be installed as globals')
assert('archive' in options.globals, 'the mod should receive only its own archive resource capability')
assert('piu/MC' in options.modules, 'compartment should expose the attenuated Piu module')
assert(!('modules' in options.modules), 'host Modules should not be exposed to the compartment')
equal(options.resolveHook('piu/MC', 'miniapp'), 'piu/MC', 'allowlisted imports should resolve')
assert(!isMiniAppImportAllowed('http'), 'imports outside the mini app allowlist should be rejected')
assert(definition.create() instanceof Container, 'allowlisted Piu constructors should remain usable')

const registry = new MiniAppRegistry()
registerExperimentalMiniApps(pack, registry)
equal(registry.list().length, 1, 'validated archive definitions should register')

trace('ok\n')
