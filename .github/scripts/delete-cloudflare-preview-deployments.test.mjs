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

function deployment({ branch = BRANCH_NAME, environment = 'preview', id }) {
  return {
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
        deployment({ id: KEEP_ID }),
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
      result: [],
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
