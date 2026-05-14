import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'

const packageDir = 'dist-tests/node_modules/ChatAudioIO'
mkdirSync(packageDir, { recursive: true })
writeFileSync(`${packageDir}/package.json`, JSON.stringify({ type: 'module', main: './index.js' }))
copyFileSync('dist-tests/stackchan/services/chat-audioio-stub.js', `${packageDir}/index.js`)
