import { SimpleFace } from 'behaviors/face'
import { registerUIFactory } from 'stackchan-factory-registry'
import { asStackchanUIOptions, createRegisteredStackchanUI } from 'stackchan-factory-registry/ui'

registerUIFactory('simple', (param) => createRegisteredStackchanUI(new SimpleFace(), asStackchanUIOptions(param)))
