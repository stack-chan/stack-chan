import { readFile } from 'node:fs/promises'

import { aggregateMetricsReports } from './metrics.mjs'

const paths = process.argv.slice(2)
if (paths.length === 0) {
  console.error('usage: npm run metrics:aggregate -- participant-1.json participant-2.json ...')
  process.exitCode = 2
} else {
  const reports = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))))
  console.log(JSON.stringify(aggregateMetricsReports(reports), null, 2))
}
