# Branch and Release Flow

This repository uses the following branch model:

```text
main <- develop <- feat/* | fix/*
```

## Branch roles

- `main` is the stable branch. It should represent released or release-ready source and is the branch users can rely on for setup instructions.
- `develop` is the default branch and integration branch for the next release. Feature and fix pull requests target this branch by default.
- `feat/*` and `fix/*` are topic branches for focused changes.

## Pull requests

- Create topic branches from `develop`.
- Open feature and fix pull requests against `develop`.
- Keep each pull request focused on one change.
- Include the release impact in the pull request description: `none`, `patch`, `minor`, or `major`.
- Add a Changeset or release note text for user-visible firmware or web changes, or explain why none is needed.

## Releases

Releases move reviewed changes from `develop` to `main`.

The expected release path is:

1. Merge feature and fix pull requests into `develop`.
2. Open a release pull request from `develop` to `main`.
3. Review accumulated release notes and Changesets.
4. Merge the release pull request after validation.

Changesets are configured with `develop` as the release base branch. Automated release pull requests, version bumps, changelog generation, and firmware version embedding are future work.
