# Changesets Foundation

This directory reserves the repository-level configuration for future changelog and release-note automation.

Current scope:

- Track the release base branch as `dev/v1.0` during the migration to `develop`
- Keep the repository ready for future release PR automation
- Keep release automation separate from the current firmware and web package workflows

Future work can switch the release base branch to `develop`, add the root package manager setup, and add the release workflow once the maintainers create the remote `develop` branch and decide how version bumps should map to firmware and web deliverables.
