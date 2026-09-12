# Configure Cloudflare Pages PR previews

PR previews deploy to a dedicated Cloudflare Pages project, independently of the existing GitHub Pages production site.
Pull requests targeting `develop` or `main` are eligible when they change `firmware/**`, `web/**`, or another path watched by the Bundle workflow, including pull requests from external forks.
The preview resolver is loaded from the default branch (`develop`). It does not allow `milestone/sdk-redesign`, so automatic deployment is skipped for milestone pull requests. Use their Bundle artifacts locally during the milestone.

## Preview milestone artifacts locally

1. Open the successful `Bundle Stack-chan Firmware` run for the pull request's current head commit.
2. Download and extract its `cloudflare-pages-preview` artifact. Artifacts are retained for two days; rerun the workflow if they have expired.
3. Serve the extracted directory over localhost, for example with `python3 -m http.server 8000 --bind 127.0.0.1 --directory /path/to/extracted-preview`.
4. Open `http://localhost:8000/` and verify the web tools and simulator. Record the head commit, workflow run URL, and result in the pull request.

A successful deployment workflow alone does not prove that a preview was published: it can succeed after skipping an ineligible base branch. A URL published before a pull request was retargeted to the milestone shows an older commit and must not be used to validate the current head.
The deployment workflow keeps scripts on the trusted default branch; preview artifacts are served as static content and are not executed in a job with Cloudflare credentials.

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
