import { cleanBuildOutputDirectory } from './lib/build-output.mjs'

const outputDirectory = cleanBuildOutputDirectory()
console.log(`Cleaned ${outputDirectory}`)
