# Contributing

Pull requests of all sizes are welcome.

Examples of useful contributions:

- New accessories, cases, and schematics improvements
- Firmware fixes and new examples on top of the firmware
- Tooling, CI, and development environment improvements
- Documentation fixes and translations

## Before opening a pull request

- Base your branch on `dev/v1.0`
- Keep each pull request focused on a single topic
- Run the relevant checks before opening the pull request

For firmware changes:

```bash
cd firmware
npm run format
npm run lint
npm run test
```

If your change depends on Moddable or ESP-IDF tooling, include the build or runtime command you used in the pull request description.

## Pull request expectations

- Describe the problem and the intended change
- List the directories or subsystems affected
- Include verification steps that another contributor can run
- Call out any breaking change or hardware-specific behavior
- Classify the release impact as `none`, `patch`, `minor`, or `major`
- If the PR changes a released firmware or web deliverable, include the release note or changeset text, or explain why no release note is needed

## Review expectations

- Reviewers should confirm the stated release impact matches the actual user-visible change
- Firmware and web changes that affect released behavior should not merge without a release note or an explicit reason it is not needed
- Docs, CI, repository metadata, case, and schematics changes should be checked for release impact before asking for a release note or changeset

## Issue reports

Bug reports should include:

- Steps to reproduce
- Expected and actual behavior
- Logs, screenshots, or photos when they help
- Your OS, editor, target device, and firmware branch/version

Take it easy and stay healthy. Thank you very much.
