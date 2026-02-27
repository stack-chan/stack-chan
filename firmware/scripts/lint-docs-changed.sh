#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
firmware_root="$(cd -- "${script_dir}/.." && pwd)"
repo_root="$(git -C "${firmware_root}" rev-parse --show-toplevel)"
markdownlint="${firmware_root}/node_modules/.bin/markdownlint-cli2"
cd "${repo_root}"

if [[ ! -x "${markdownlint}" ]]; then
  echo "markdownlint-cli2 is not installed. Run 'npm ci' in firmware/ first."
  exit 1
fi

base_ref="${DOC_LINT_BASE:-}"
if [[ -z "${base_ref}" && -n "${GITHUB_BASE_REF:-}" ]]; then
  base_ref="origin/${GITHUB_BASE_REF}"
fi
if [[ -z "${base_ref}" ]]; then
  base_ref="origin/dev/v1.0"
fi

if [[ "${base_ref}" == origin/* ]]; then
  git fetch --no-tags origin "${base_ref#origin/}" >/dev/null 2>&1 || true
fi

if ! git rev-parse --verify "${base_ref}" >/dev/null 2>&1; then
  echo "Base ref '${base_ref}' was not found. Falling back to HEAD~1."
  base_ref="HEAD~1"
fi

if ! git rev-parse --verify "${base_ref}" >/dev/null 2>&1; then
  echo "Unable to resolve a base ref. Skipping markdown lint."
  exit 0
fi

merge_base="$(git merge-base "${base_ref}" HEAD)"
files=()
while IFS= read -r -d '' file; do
  files+=("${file}")
done < <(git diff --name-only --diff-filter=ACMR -z "${merge_base}...HEAD" -- "*.md" "*.markdown")

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No changed Markdown files to lint."
  exit 0
fi

echo "Linting changed Markdown files:"
printf ' - %s\n' "${files[@]}"
"${markdownlint}" --config "${repo_root}/.markdownlint-cli2.yaml" "${files[@]}"
