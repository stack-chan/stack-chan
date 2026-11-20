# Configure Cloudflare Pages PR previews

PR previews deploy to a dedicated Cloudflare Pages project, independently of the existing GitHub Pages production site.
Pull requests that change `firmware/**` or `web/**` are eligible, including pull requests from external forks.

## Cloudflare Pages project

Create a Pages project using Direct Upload from Workers & Pages in the Cloudflare dashboard.

- Project name: `stack-chan-pr-preview`
- Production branch: `production`
- Access policy: disabled (public previews)

Do not connect this project to the GitHub repository.
GitHub Actions uploads the prebuilt static site directly.

## Cloudflare API token

Create a custom token in Cloudflare API Tokens.
Grant only `Account / Cloudflare Pages / Edit` for the account that owns the preview project.

Add these values under GitHub repository Settings, Secrets and variables, Actions:

| Kind     | Name                       | Value                     |
| -------- | -------------------------- | ------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`     | The custom API token      |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`    | The Cloudflare account ID |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | `stack-chan-pr-preview`   |

## Verify the integration

Open a pull request that changes `web/**` or another watched path, then verify:

1. `Bundle Stack-chan Firmware` succeeds.
2. `Deploy Cloudflare PR Preview` succeeds afterward.
3. A `Cloudflare PR preview` comment appears on the pull request.
4. The web tools and simulator open at `https://pr-<number>.<Pages project subdomain>.pages.dev`.
5. Closing the pull request replaces that URL with a preview-closed page.

External pull request previews contain untrusted JavaScript and firmware.
Do not grant WebSerial or Bluetooth permissions or flash a device until the changes have been reviewed.
