import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PREVIEW_COMMENT_MARKER, upsertPreviewComment } from './upsert-preview-comment.mjs'

function githubStub(comments = []) {
  const calls = []
  const github = {
    paginate: async () => comments,
    rest: {
      issues: {
        listComments() {},
        async createComment(request) {
          calls.push({ operation: 'create', request })
        },
        async updateComment(request) {
          calls.push({ operation: 'update', request })
        },
      },
    },
  }
  return { calls, github }
}

test('creates a preview comment when the bot has not posted one', async () => {
  const { calls, github } = githubStub([{ user: { login: 'contributor' }, body: PREVIEW_COMMENT_MARKER }])
  await upsertPreviewComment({ github, owner: 'stack-chan', repo: 'stack-chan', issueNumber: 585, content: 'Ready' })
  assert.equal(calls[0].operation, 'create')
  assert.equal(calls[0].request.body, `${PREVIEW_COMMENT_MARKER}\nReady`)
})

test('updates an existing preview comment from the GitHub Actions bot', async () => {
  const { calls, github } = githubStub([
    { id: 42, user: { login: 'github-actions[bot]' }, body: `${PREVIEW_COMMENT_MARKER}\nOld` },
  ])
  await upsertPreviewComment({ github, owner: 'stack-chan', repo: 'stack-chan', issueNumber: 585, content: 'New' })
  assert.deepEqual(calls[0], {
    operation: 'update',
    request: {
      owner: 'stack-chan',
      repo: 'stack-chan',
      body: `${PREVIEW_COMMENT_MARKER}\nNew`,
      comment_id: 42,
    },
  })
})
