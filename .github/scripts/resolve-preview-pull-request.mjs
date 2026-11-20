const ALLOWED_BASE_BRANCHES = new Set(['develop', 'main'])

function repositoryMatches(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase() === expected.toLowerCase()
}

export async function resolvePreviewPullRequest({ github, owner, repo, run }) {
  const targetRepository = `${owner}/${repo}`
  let number = run.pull_requests?.[0]?.number

  if (!number) {
    const headOwner = run.head_repository?.owner?.login ?? run.head_repository?.full_name?.split('/', 1)[0]
    if (headOwner && run.head_branch) {
      const candidates = await github.paginate(github.rest.pulls.list, {
        owner,
        repo,
        state: 'open',
        head: `${headOwner}:${run.head_branch}`,
        per_page: 100,
      })
      number = candidates.find(
        (pull) =>
          repositoryMatches(pull.base?.repo?.full_name, targetRepository) &&
          ALLOWED_BASE_BRANCHES.has(pull.base?.ref) &&
          pull.head?.sha === run.head_sha,
      )?.number
    }
  }

  if (!number) {
    return { eligible: false }
  }

  const { data: pull } = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: number,
  })
  const allowedBase = ALLOWED_BASE_BRANCHES.has(pull.base.ref)
  const targetBase = repositoryMatches(pull.base.repo?.full_name, targetRepository)
  const currentCommit = [pull.head.sha, pull.merge_commit_sha].includes(run.head_sha)
  const currentHead =
    repositoryMatches(pull.head.repo?.full_name, run.head_repository?.full_name) && pull.head.ref === run.head_branch
  const eligible = pull.state === 'open' && allowedBase && targetBase && currentCommit && currentHead

  return {
    eligible,
    headSha: pull.head.sha,
    number,
  }
}
