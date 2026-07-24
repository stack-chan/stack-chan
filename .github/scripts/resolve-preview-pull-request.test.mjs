import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolvePreviewPullRequest } from './resolve-preview-pull-request.mjs'

const RUN = {
  head_branch: 'agent/web-react-vite-refactor',
  head_repository: {
    full_name: 'sskw-ugo/stack-chan-pr',
    owner: { login: 'sskw-ugo' },
  },
  head_sha: '2a7b74b39e879f27d4a1d99bc351b6d99433dd60',
  pull_requests: [],
}

function pull(overrides = {}) {
  return {
    base: {
      ref: 'develop',
      repo: { full_name: 'stack-chan/stack-chan' },
    },
    head: {
      ref: RUN.head_branch,
      repo: { full_name: RUN.head_repository.full_name },
      sha: RUN.head_sha,
    },
    merge_commit_sha: 'merge-sha',
    number: 592,
    state: 'open',
    ...overrides,
  }
}

function githubStub({ candidates = [], resolvedPull = pull() } = {}) {
  const calls = []
  const github = {
    async paginate(method, request) {
      calls.push({ operation: 'list', request })
      assert.equal(method, github.rest.pulls.list)
      return candidates
    },
    rest: {
      pulls: {
        list() {},
        async get(request) {
          calls.push({ operation: 'get', request })
          return { data: resolvedPull }
        },
      },
    },
  }
  return { calls, github }
}

test('resolves a fork pull request when workflow_run omits pull_requests', async () => {
  const { calls, github } = githubStub({ candidates: [pull()] })

  const result = await resolvePreviewPullRequest({
    github,
    owner: 'stack-chan',
    repo: 'stack-chan',
    run: RUN,
  })

  assert.deepEqual(result, {
    eligible: true,
    headSha: RUN.head_sha,
    number: 592,
  })
  assert.deepEqual(calls, [
    {
      operation: 'list',
      request: {
        owner: 'stack-chan',
        repo: 'stack-chan',
        state: 'open',
        head: 'sskw-ugo:agent/web-react-vite-refactor',
        per_page: 100,
      },
    },
    {
      operation: 'get',
      request: {
        owner: 'stack-chan',
        repo: 'stack-chan',
        pull_number: 592,
      },
    },
  ])
})

test('uses the pull request supplied by workflow_run without listing candidates', async () => {
  const { calls, github } = githubStub()

  const result = await resolvePreviewPullRequest({
    github,
    owner: 'stack-chan',
    repo: 'stack-chan',
    run: { ...RUN, pull_requests: [{ number: 592 }] },
  })

  assert.equal(result.eligible, true)
  assert.deepEqual(
    calls.map(({ operation }) => operation),
    ['get'],
  )
})

test('does not resolve a candidate from another base repository', async () => {
  const candidate = pull({
    base: {
      ref: 'develop',
      repo: { full_name: 'another-owner/stack-chan' },
    },
  })
  const { calls, github } = githubStub({ candidates: [candidate] })

  const result = await resolvePreviewPullRequest({
    github,
    owner: 'stack-chan',
    repo: 'stack-chan',
    run: RUN,
  })

  assert.deepEqual(result, { eligible: false })
  assert.deepEqual(
    calls.map(({ operation }) => operation),
    ['list'],
  )
})

test('rejects a stale workflow run after resolving its pull request', async () => {
  const { github } = githubStub({
    candidates: [pull()],
    resolvedPull: pull({
      head: {
        ref: RUN.head_branch,
        repo: { full_name: RUN.head_repository.full_name },
        sha: 'newer-sha',
      },
    }),
  })

  const result = await resolvePreviewPullRequest({
    github,
    owner: 'stack-chan',
    repo: 'stack-chan',
    run: RUN,
  })

  assert.deepEqual(result, {
    eligible: false,
    headSha: 'newer-sha',
    number: 592,
  })
})
