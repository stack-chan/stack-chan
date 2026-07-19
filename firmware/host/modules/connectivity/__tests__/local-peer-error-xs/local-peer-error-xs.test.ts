import { LocalPeerError } from 'local-peer-types'

const error = new LocalPeerError('timeout', 'test timeout')
if (error.name !== 'LocalPeerError') throw new Error(`unexpected error name: ${error.name}`)
if (error.code !== 'timeout') throw new Error(`unexpected error code: ${error.code}`)
if (error.message !== 'test timeout') throw new Error(`unexpected error message: ${error.message}`)

trace('ok\n')
