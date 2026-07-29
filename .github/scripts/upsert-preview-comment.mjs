export const PREVIEW_COMMENT_MARKER = '<!-- stackchan-cloudflare-preview -->'

export async function upsertPreviewComment({ github, owner, repo, issueNumber, content }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
  })
  const existing = comments.find(
    (comment) => comment.user?.login === 'github-actions[bot]' && comment.body?.includes(PREVIEW_COMMENT_MARKER)
  )
  const body = `${PREVIEW_COMMENT_MARKER}\n${content.trim()}`
  const request = { owner, repo, body }
  if (existing) {
    await github.rest.issues.updateComment({ ...request, comment_id: existing.id })
  } else {
    await github.rest.issues.createComment({ ...request, issue_number: issueNumber })
  }
}
