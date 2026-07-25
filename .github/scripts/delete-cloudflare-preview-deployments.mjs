#!/usr/bin/env node

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateCloudflareConfig } from './validate-cloudflare-config.mjs'

const CLOUDFLARE_API_ROOT = 'https://api.cloudflare.com/client/v4'
const MAX_ATTEMPTS = 3
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function errorDetails(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : []
  if (errors.length === 0) return 'Cloudflare did not return error details'
  return errors
    .map((error) => {
      const code = error?.code == null ? 'unknown' : error.code
      const message =
        typeof error?.message === 'string' ? error.message.replace(/\s+/g, ' ').trim() : 'Unknown error'
      return `[${code}] ${message}`
    })
    .join('; ')
}

async function cloudflareRequest({
  apiToken,
  fetchImpl,
  logger,
  method = 'GET',
  requireEnvelope = false,
  sleep,
  url,
}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
        method,
      })
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`Cloudflare API ${method} request failed before receiving a response: ${message}`)
      }
      logger.warn(`Cloudflare API ${method} request failed; retrying (${attempt}/${MAX_ATTEMPTS})`)
      await sleep(250 * 2 ** (attempt - 1))
      continue
    }

    if (method === 'DELETE' && response.status === 404) return

    const responseText = await response.text()
    let payload
    if (responseText) {
      try {
        payload = JSON.parse(responseText)
      } catch {
        throw new Error(`Cloudflare API ${method} returned a non-JSON response (HTTP ${response.status})`)
      }
    }

    const succeeded = response.ok && payload?.success !== false && (!requireEnvelope || payload?.success === true)
    if (succeeded) return payload

    const requestError = new Error(
      `Cloudflare API ${method} failed (HTTP ${response.status}): ${errorDetails(payload)}`
    )
    if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === MAX_ATTEMPTS) throw requestError

    logger.warn(`Cloudflare API ${method} returned HTTP ${response.status}; retrying (${attempt}/${MAX_ATTEMPTS})`)
    await sleep(250 * 2 ** (attempt - 1))
  }

  throw new Error(`Cloudflare API ${method} exhausted its retry attempts`)
}

function validateCleanupOptions({ accountId, apiToken, branchName, keepDeploymentId, projectName }) {
  validateCloudflareConfig({
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
    CLOUDFLARE_PAGES_PROJECT: projectName,
  })
  if (!/^pr-[1-9]\d*$/.test(branchName)) {
    throw new Error('BRANCH_NAME must identify a pull request preview branch')
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keepDeploymentId)
  ) {
    throw new Error('KEEP_DEPLOYMENT_ID must be a Cloudflare deployment UUID')
  }
}

async function listDeployments({ accountId, apiToken, fetchImpl, logger, projectName, sleep }) {
  const deploymentUrl =
    `${CLOUDFLARE_API_ROOT}/accounts/${encodeURIComponent(accountId)}` +
    `/pages/projects/${encodeURIComponent(projectName)}/deployments`
  const deployments = []
  let page = 1
  let totalPages = 1

  do {
    const url = new URL(deploymentUrl)
    // Keep the first request identical to Cloudflare's documented example.
    // Filtering locally means cleanup only relies on required API parameters.
    if (page > 1) url.searchParams.set('page', String(page))
    const payload = await cloudflareRequest({
      apiToken,
      fetchImpl,
      logger,
      requireEnvelope: true,
      sleep,
      url,
    })
    if (!Array.isArray(payload.result)) {
      throw new Error('Cloudflare deployment list response did not contain a result array')
    }
    deployments.push(...payload.result)

    totalPages = payload.result_info?.total_pages ?? 1
    if (!Number.isSafeInteger(totalPages) || totalPages < 0 || totalPages > 10_000) {
      throw new Error('Cloudflare deployment list response contained invalid pagination metadata')
    }
    page += 1
  } while (page <= totalPages)

  return deployments
}

export async function deleteSupersededPreviewDeployments({
  accountId,
  apiToken,
  branchName,
  fetchImpl = globalThis.fetch,
  keepDeploymentId,
  logger = console,
  projectName,
  sleep = delay,
}) {
  validateCleanupOptions({ accountId, apiToken, branchName, keepDeploymentId, projectName })
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required')

  const deployments = await listDeployments({
    accountId,
    apiToken,
    fetchImpl,
    logger,
    projectName,
    sleep,
  })
  const branchDeployments = deployments.filter(
    (deployment) =>
      deployment?.environment === 'preview' &&
      deployment?.deployment_trigger?.metadata?.branch === branchName
  )
  const keepDeployment = branchDeployments.find((deployment) => deployment?.id === keepDeploymentId)
  if (!keepDeployment) {
    throw new Error('KEEP_DEPLOYMENT_ID does not belong to the requested preview branch')
  }
  const branchAlias = `https://${branchName}.${projectName}.pages.dev`
  if (!Array.isArray(keepDeployment.aliases) || !keepDeployment.aliases.includes(branchAlias)) {
    throw new Error('KEEP_DEPLOYMENT_ID does not own the active preview branch alias')
  }
  const deploymentIds = [
    ...new Set(
      branchDeployments
        .filter((deployment) => deployment?.id !== keepDeploymentId && typeof deployment?.id === 'string')
        .map((deployment) => deployment.id)
    ),
  ]

  const deletedIds = []
  const failures = []
  for (const deploymentId of deploymentIds) {
    const url =
      `${CLOUDFLARE_API_ROOT}/accounts/${encodeURIComponent(accountId)}` +
      `/pages/projects/${encodeURIComponent(projectName)}` +
      `/deployments/${encodeURIComponent(deploymentId)}?force=true`
    try {
      await cloudflareRequest({
        apiToken,
        fetchImpl,
        logger,
        method: 'DELETE',
        sleep,
        url,
      })
      deletedIds.push(deploymentId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ error, message: `${deploymentId}: ${message}` })
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      `Failed to delete ${failures.length} superseded deployment(s): ${failures
        .map(({ message }) => message)
        .join('; ')}`
    )
  }

  return deletedIds
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  try {
    const deleted = await deleteSupersededPreviewDeployments({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      branchName: process.env.BRANCH_NAME,
      keepDeploymentId: process.env.KEEP_DEPLOYMENT_ID,
      projectName: process.env.CLOUDFLARE_PAGES_PROJECT,
    })
    console.log(`Deleted ${deleted.length} superseded Cloudflare preview deployment(s)`)
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
