#!/usr/bin/env bash
# Usage: scripts/release.sh <X.Y.Z>
set -euo pipefail

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

[[ $# -eq 1 && $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Usage: scripts/release.sh <X.Y.Z>'
version=$1
tag="v$version"

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ $(git branch --show-current) == main ]] || fail 'Current branch must be main'
[[ -z $(git status --porcelain) ]] || fail 'Working tree must be clean'
origin_url=$(git remote get-url origin) || fail 'Configure the Memora origin remote before releasing'
case "$origin_url" in
  https://*) release_repo=${origin_url#https://} ;;
  git@*:*) release_repo=${origin_url#git@}; release_repo=${release_repo/:/\/} ;;
  *) fail 'origin must use https://host/owner/repo or git@host:owner/repo' ;;
esac
release_repo=${release_repo%.git}
[[ $release_repo =~ ^[a-zA-Z0-9.-]+/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || fail 'Cannot resolve the GitHub release repository from origin'

# One repository release covers the core and both peer adapters.
npm test

# Keep the section's trailing newlines when passing notes to gh.
notes=$(
  awk -v heading="## [$version]" '
    /^## \[/ {
      if (found) exit
      if (index($0, heading) == 1) { found = 1; next }
    }
    found { print }
    END { if (!found) exit 1 }
  ' CHANGELOG.md && printf '.'
) || fail "CHANGELOG.md is missing a ## [$version] heading"
notes=${notes%.}

if git show-ref --verify --quiet "refs/tags/$tag"; then
  fail "Tag $tag already exists locally"
fi
remote_tag=$(git ls-remote --tags origin "refs/tags/$tag") || fail 'Cannot read tags from origin'
[[ -z $remote_tag ]] || fail "Tag $tag already exists on origin"

npm version "$version" --no-git-tag-version --allow-same-version --workspaces --include-workspace-root --ignore-scripts
if ! git diff --quiet -- package.json packages/core/package.json packages/pi-memory/package.json packages/dsh-memory/package.json package-lock.json; then
  git add -- package.json packages/core/package.json packages/pi-memory/package.json packages/dsh-memory/package.json package-lock.json
  git commit -m "Release $tag"
fi
npm run pack:adapters
git tag -a "$tag" -m "$tag"
git push origin main
git push origin "$tag"
gh release create "$tag" "pi-memory-${version}.tgz" "dsh-memory-${version}.tgz" --repo "$release_repo" --verify-tag --title "Memora $tag" --notes "$notes"
printf 'Released Memora %s with pi-memory and dsh-memory packages.\n' "$tag"
