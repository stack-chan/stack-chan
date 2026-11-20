import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { aggregateMetricsReports } from './metrics.mjs'

export async function aggregateMetricsFiles(paths) {
  const reports = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))))
  return aggregateMetricsReports(reports)
}

export async function runMetricsAggregateCli(
  paths,
  { writeOutput = (value) => console.log(value), writeError = (value) => console.error(value) } = {}
) {
  if (paths.length === 0) {
    writeError('usage: npm run metrics:aggregate -- participant-1.json participant-2.json ...')
    return 2
  }
  writeOutput(JSON.stringify(await aggregateMetricsFiles(paths), null, 2))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runMetricsAggregateCli(process.argv.slice(2))
}
