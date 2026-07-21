# Branch and Release Flow

This repository uses the following branch model for a frozen release:

```text
main <- release/* <- develop <- feat/* | fix/*
```

## Branch roles

- `main` is the stable branch. It should represent released or release-ready source and is the branch users can rely on for setup instructions.
- `develop` is the default branch and integration branch for the next release. Feature and fix pull requests target this branch by default.
- `release/*` is a temporary branch cut from a fixed `develop` commit. Only release metadata and changes required to reconcile `main` are added after the freeze.
- `feat/*` and `fix/*` are topic branches for focused changes.

## Pull requests

- Create topic branches from `develop`.
- Open feature and fix pull requests against `develop`.
- Keep each pull request focused on one change.
- Include the release impact in the pull request description: `none`, `patch`, `minor`, or `major`.
- Add a Changeset or release note text for user-visible firmware or web changes, or explain why none is needed.

## Releases

Releases move a frozen and reviewed `develop` snapshot to `main` through a release branch.

The expected release path is:

1. Merge the intended feature and fix pull requests into `develop` and select the exact release commit.
2. Create `release/vX.Y.Z` from that commit and reconcile the current `main` history on the release branch.
3. Update package versions, review accumulated release notes and Changesets, and open a pull request from the release branch to `main`.
4. Merge the release pull request after automated and hardware validation, then tag the resulting `main` commit.
5. Merge `main` back into `develop` after publication.

Changesets are configured with `develop` as the release base branch. Version bumps and release notes are prepared on the release branch. A stable `vX.Y.Z` tag validates the versions, rebuilds the firmware bundle, and publishes the GitHub Release assets. Automated release pull requests and firmware product-version embedding remain future work.
