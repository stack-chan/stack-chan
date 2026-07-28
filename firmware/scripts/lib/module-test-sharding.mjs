const INDEX_ENV = 'STACKCHAN_MODULE_TEST_SHARD_INDEX'
const TOTAL_ENV = 'STACKCHAN_MODULE_TEST_SHARD_TOTAL'

function parseNonNegativeInteger(name, value) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return Number.parseInt(value, 10)
}

export function parseModuleTestShard(environment = process.env) {
  const indexValue = environment[INDEX_ENV]
  const totalValue = environment[TOTAL_ENV]

  if (indexValue == null && totalValue == null) {
    return { index: 0, total: 1, configured: false }
  }
  if (indexValue == null || totalValue == null) {
    throw new Error(`${INDEX_ENV} and ${TOTAL_ENV} must be set together`)
  }

  const index = parseNonNegativeInteger(INDEX_ENV, indexValue)
  const total = parseNonNegativeInteger(TOTAL_ENV, totalValue)
  if (total < 1) {
    throw new Error(`${TOTAL_ENV} must be at least 1`)
  }
  if (index >= total) {
    throw new Error(`${INDEX_ENV} must be less than ${TOTAL_ENV}`)
  }

  return { index, total, configured: true }
}

export function selectModuleTestShard(items, shard) {
  return items.filter((_, index) => index % shard.total === shard.index)
}
