import { DogFace } from 'behaviors/face'
import { registerUIFactory } from 'stackchan-factory-registry'
import { asStackchanUIOptions, createRegisteredStackchanUI } from 'stackchan-factory-registry/ui'

registerUIFactory('dog', (param) => createRegisteredStackchanUI(new DogFace(), asStackchanUIOptions(param)))
