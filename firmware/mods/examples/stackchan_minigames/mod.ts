import { definePiuApp } from 'stackchan/extensions/piu'
import catchGame from './catch.js'
import jump from './jump.js'

export default definePiuApp({ screens: [...jump, ...catchGame] })
