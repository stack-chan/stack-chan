import { createLocalPeerAuthenticationTag, deriveLocalPeerAuthenticationKey } from 'local-peer-auth'
import { LocalPeerError } from 'local-peer-types'

const error = new LocalPeerError('timeout', 'test timeout')
if (error.name !== 'LocalPeerError') throw new Error(`unexpected error name: ${error.name}`)
if (error.code !== 'timeout') throw new Error(`unexpected error code: ${error.code}`)
if (error.message !== 'test timeout') throw new Error(`unexpected error message: ${error.message}`)

const tag = createLocalPeerAuthenticationTag(
  deriveLocalPeerAuthenticationKey('correct horse battery staple'),
  Uint8Array.of(0x00, 0x11, 0x22, 0x33, 0x44, 0x55),
  Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff),
  Uint8Array.of(1, 2, 3),
)
const actualTag = [...tag].map((value) => value.toString(16).padStart(2, '0')).join('')
if (actualTag !== 'c146beea7bcde4b7933b3a74434b0bfb') throw new Error(`unexpected authentication tag: ${actualTag}`)

trace('ok\n')
