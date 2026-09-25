# Gallery source synchronization

Firmware examples are the source of truth for the files declared in
`sample-sources.json`. From the repository root, run:

```sh
npm --prefix web run sync:gallery
npm --prefix web run check:gallery
```

The first command copies changed or missing files byte-for-byte. The second
reports stale copies without writing and exits unsuccessfully when synchronization
is needed. Both commands resolve paths relative to the script, independently of
the working directory. The existing web test suite also checks the copies, so CI
detects forgotten synchronization without silently fixing the working tree.

Update the firmware example, run synchronization, and include the changed gallery
copies in the same pull request. Add new shared sources, images, README files or
third-party license files to the corresponding mapping. Review removed files
explicitly: the command only owns mapped files and never deletes other content.

This is an incremental step toward issue #689. Generated copies remain tracked
and keep their existing package-relative URLs. Gallery definitions, gallery-only
instructions and prebuilt XSA archives remain separately maintained. Synchronizing
JavaScript or TypeScript does **not** rebuild an XSA or establish that it matches
the new source; follow the existing firmware build and device validation workflow
when updating executable artifacts. A build-only gallery and XSA generation policy
are separate follow-up decisions.

Release impact: none. This changes contributor tooling and drift checks, without
changing the distributed sample bytes or runtime behavior.
