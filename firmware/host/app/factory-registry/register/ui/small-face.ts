import { SmallFace } from 'behaviors/face'
import { registerUIFactory } from 'stackchan-factory-registry'
import { asStackchanUIOptions, createRegisteredStackchanUI } from 'stackchan-factory-registry/ui'

registerUIFactory('small-face', (param) => createRegisteredStackchanUI(new SmallFace(), asStackchanUIOptions(param)))
