import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deleteSupersededPreviewDeployments } from './delete-cloudflare-preview-deployments.mjs'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const API_TOKEN = 'secret'
const BRANCH_NAME = 'pr-595'
const KEEP_ID = '00000000-0000-4000-8000-000000000001'
const OLD_ID_1 = '00000000-0000-4000-8000-000000000002'
const OLD_ID_2 = '00000000-0000-4000-8000-000000000003'
const PROJECT_NAME = 'stack-chan-pr-preview'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

function deployment({ aliases = [], branch = BRANCH_NAME, environment = 'preview', id }) {
  return {
    aliases,
    deployment_trigger: {
      metadata: { branch },
    },
    environment,
    id,
  }
}

function cleanupOptions(overrides = {}) {
  return {
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    branchName: BRANCH_NAME,
    keepDeploymentId: KEEP_ID,
    logger: { warn() {} },
    projectName: PROJECT_NAME,
    sleep: async () => {},
    ...overrides,
  }
}

test('lists every page and deletes only superseded deployments from the target preview branch', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url)
    calls.push({ method: options.method, url: requestUrl.href, authorization: options.headers.Authorization })

    if (options.method === 'DELETE') {
      return jsonResponse({ errors: [], result: null, success: true })
    }
    if (requestUrl.searchParams.get('page') === '2') {
      return jsonResponse({
        errors: [],
        result: [deployment({ id: OLD_ID_2 }), deployment({ id: OLD_ID_1 })],
        result_info: { total_pages: 2 },
        success: true,
      })
    }
    return jsonResponse({
      errors: [],
      result: [
        deployment({ aliases: [`https://${BRANCH_NAME}.${PROJECT_NAME}.pages.dev`], id: KEEP_ID }),
        deployment({ id: OLD_ID_1 }),
        deployment({ branch: 'pr-594', id: '00000000-0000-4000-8000-000000000004' }),
        deployment({ environment: 'production', id: '00000000-0000-4000-8000-000000000005' }),
      ],
      result_info: { total_pages: 2 },
      success: true,
    })
  }

  const deleted = await deleteSupersededPreviewDeployments(cleanupOptions({ fetchImpl }))

  assert.deepEqual(deleted, [OLD_ID_1, OLD_ID_2])
  assert.deepEqual(
    calls.map(({ method, url }) => ({ method, url })),
    [
      {
        method: 'GET',
        url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments`,
      },
      {
        method: 'GET',
        url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments?page=2`,
      },
      {
        method: 'DELETE',
        url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments/${OLD_ID_1}?force=true`,
      },
      {
        method: 'DELETE',
        url: `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/deployments/${OLD_ID_2}?force=true`,
      },
    ]
  )
  assert.ok(calls.every(({ authorization }) => authorization === `Bearer ${API_TOKEN}`))
})

test('reports Cloudflare API error details instead of hiding the response body', async () => {
  const fetchImpl = async () =>
    jsonResponse(
      {
        errors: [{ code: 8000034, message: 'Invalid pagination parameter' }],
        result: null,
        success: false,
      },
      400
    )

  await assert.rejects(
    deleteSupersededPreviewDeployments(cleanupOptions({ fetchImpl })),
    /Cloudflare API GET failed \(HTTP 400\): \[8000034\] Invalid pagination parameter/
  )
})

test('retries transient Cloudflare API failures', async () => {
  const delays = []
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    if (attempts === 1) {
      return jsonResponse({ errors: [{ code: 1000, message: 'Temporarily unavailable' }], success: false }, 503)
    }
    return jsonResponse({
      errors: [],
      result: [deployment({ aliases: [`https://${BRANCH_NAME}.${PROJECT_NAME}.pages.dev`], id: KEEP_ID })],
      result_info: { total_pages: 1 },
      success: true,
    })
  }

  const deleted = await deleteSupersededPreviewDeployments(
    cleanupOptions({
      fetchImpl,
      sleep: async (milliseconds) => delays.push(milliseconds),
    })
  )

  assert.deepEqual(deleted, [])
  assert.equal(attempts, 2)
  assert.deepEqual(delays, [250])
})

test('retries non-JSON responses with transient HTTP status codes', async () => {
  const delays = []
  let attempts = 0
  const fetchImpl = async () => {
    attempts += 1
    if (attempts === 1) {
      return new Response('<html>Service unavailable</html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 503,
      })
    }
    return jsonResponse({
      errors: [],
      result: [deployment({ aliases: [`https://${BRANCH_NAME}.${PROJECT_NAME}.pages.dev`], id: KEEP_ID })],
      result_info: { total_pages: 1 },
      success: true,
    })
  }

  const deleted = await deleteSupersededPreviewDeployments(
    cleanupOptions({
      fetchImpl,
      sleep: async (milliseconds) => delays.push(milliseconds),
    })
  )

  assert.deepEqual(deleted, [])
  assert.equal(attempts, 2)
  assert.deepEqual(delays, [250])
})

test('treats a 404 after retrying a DELETE as already deleted', async () => {
  const delays = []
  let deleteAttempts = 0
  const fetchImpl = async (_url, options) => {
    if (options.method === 'DELETE') {
      deleteAttempts += 1
      if (deleteAttempts === 1) throw new Error('Response was lost')
      return jsonResponse({ errors: [{ code: 8000007, message: 'Deployment not found' }], success: false }, 404)
    }
    return jsonResponse({
      errors: [],
      result: [
        deployment({ aliases: [`https://${BRANCH_NAME}.${PROJECT_NAME}.pages.dev`], id: KEEP_ID }),
        deployment({ id: OLD_ID_1 }),
      ],
      result_info: { total_pages: 1 },
      success: true,
    })
  }

  const deleted = await deleteSupersededPreviewDeployments(
    cleanupOptions({
      fetchImpl,
      sleep: async (milliseconds) => delays.push(milliseconds),
    })
  )

  assert.deepEqual(deleted, [OLD_ID_1])
  assert.equal(deleteAttempts, 2)
  assert.deepEqual(delays, [250])
})

test('refuses to delete deployments when the retained deployment does not own the branch alias', async () => {
  let deleteAttempts = 0
  const fetchImpl = async (_url, options) => {
    if (options.method === 'DELETE') {
      deleteAttempts += 1
      return jsonResponse({ errors: [], result: null, success: true })
    }
    return jsonResponse({
      errors: [],
      result: [deployment({ id: KEEP_ID }), deployment({ id: OLD_ID_1 })],
      result_info: { total_pages: 1 },
      success: true,
    })
  }

  await assert.rejects(
    deleteSupersededPreviewDeployments(cleanupOptions({ fetchImpl })),
    /KEEP_DEPLOYMENT_ID does not own the active preview branch alias/
  )
  assert.equal(deleteAttempts, 0)
})

test('attempts every deletion before reporting individual API failures', async () => {
  const attemptedIds = []
  const fetchImpl = async (url, options) => {
    const requestUrl = new URL(url)
    if (options.method === 'DELETE') {
      const deploymentId = requestUrl.pathname.split('/').at(-1)
      attemptedIds.push(deploymentId)
      if (deploymentId === OLD_ID_1) {
        return jsonResponse({ errors: [{ code: 8000001, message: 'Deletion rejected' }], success: false }, 400)
      }
      return jsonResponse({ errors: [], result: null, success: true })
    }
    return jsonResponse({
      errors: [],
      result: [
        deployment({ aliases: [`https://${BRANCH_NAME}.${PROJECT_NAME}.pages.dev`], id: KEEP_ID }),
        deployment({ id: OLD_ID_1 }),
        deployment({ id: OLD_ID_2 }),
      ],
      result_info: { total_pages: 1 },
      success: true,
    })
  }

  await assert.rejects(
    deleteSupersededPreviewDeployments(cleanupOptions({ fetchImpl })),
    new RegExp(`Failed to delete 1 superseded deployment.*${OLD_ID_1}.*Deletion rejected`)
  )
  assert.deepEqual(attemptedIds, [OLD_ID_1, OLD_ID_2])
})
