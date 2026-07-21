# Changesets Foundation

This directory stores pending release notes for user-visible firmware and web changes.

Current scope:

- Track the release base branch as `develop`
- Review and consume pending Changesets on a frozen release branch
- Publish validated firmware assets from stable `vX.Y.Z` tags using `docs/release-notes/vX.Y.Z.md`

Package version bumps and the curated release note remain explicit release-branch changes. Future work can automate release pull request creation and changelog generation.
