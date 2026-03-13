#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUBMODULE_DIR="$SCRIPT_DIR/upstream"

if [[ ! -d "$SUBMODULE_DIR/.git" && ! -f "$SUBMODULE_DIR/.git" ]]; then
  echo "ERROR: Besu submodule is not initialized."
  echo "Run: git submodule update --init --recursive infra/besu/upstream"
  exit 1
fi

TARGET_REF="${1:-${BESU_TARGET_REF:-}}"
SOURCE_BRANCH="${BESU_SOURCE_BRANCH:-}"
OLD_BASE_REF="${BESU_OLD_BASE_REF:-}"
UPSTREAM_REMOTE="${BESU_UPSTREAM_REMOTE:-upstream}"
FORK_REMOTE="${BESU_FORK_REMOTE:-origin}"

if [[ -z "$TARGET_REF" ]]; then
  echo "ERROR: target Besu ref is required."
  echo "Usage: infra/besu/upgrade-fork.sh <tag-or-commit>"
  echo "Example: infra/besu/upgrade-fork.sh 24.12.3"
  exit 1
fi

if [[ -z "$SOURCE_BRANCH" ]]; then
  SOURCE_BRANCH="$(git -C "$SUBMODULE_DIR" branch --show-current || true)"
fi

if [[ -z "$SOURCE_BRANCH" ]]; then
  echo "ERROR: source branch is required when the submodule is detached."
  echo "Set BESU_SOURCE_BRANCH, for example:"
  echo "  BESU_SOURCE_BRANCH=clawnet/ed25519-precompile infra/besu/upgrade-fork.sh $TARGET_REF"
  exit 1
fi

if ! git -C "$SUBMODULE_DIR" show-ref --verify --quiet "refs/heads/$SOURCE_BRANCH"; then
  echo "ERROR: source branch '$SOURCE_BRANCH' does not exist in $SUBMODULE_DIR"
  exit 1
fi

git -C "$SUBMODULE_DIR" fetch "$UPSTREAM_REMOTE" --tags
git -C "$SUBMODULE_DIR" fetch "$FORK_REMOTE" >/dev/null 2>&1 || true

if ! TARGET_COMMIT="$(git -C "$SUBMODULE_DIR" rev-parse --verify "$TARGET_REF^{commit}" 2>/dev/null)"; then
  echo "ERROR: could not resolve target ref '$TARGET_REF'"
  exit 1
fi

if [[ -z "$OLD_BASE_REF" ]]; then
  OLD_BASE_REF="$(git -C "$SUBMODULE_DIR" describe --tags --abbrev=0 "$SOURCE_BRANCH")"
fi

if ! OLD_BASE_COMMIT="$(git -C "$SUBMODULE_DIR" rev-parse --verify "$OLD_BASE_REF^{commit}" 2>/dev/null)"; then
  echo "ERROR: could not resolve old base ref '$OLD_BASE_REF'"
  exit 1
fi

SANITIZED_TARGET="$(printf '%s' "$TARGET_REF" | tr '/:@' '---')"
UPGRADE_BRANCH="${BESU_UPGRADE_BRANCH:-clawnet/upgrade-besu-$SANITIZED_TARGET}"

PATCH_COMMITS="$(git -C "$SUBMODULE_DIR" rev-list --reverse "$OLD_BASE_COMMIT..$SOURCE_BRANCH")"
if [[ -z "$PATCH_COMMITS" ]]; then
  echo "ERROR: no ClawNet patch commits found in range $OLD_BASE_REF..$SOURCE_BRANCH"
  exit 1
fi

git -C "$SUBMODULE_DIR" switch --detach "$TARGET_COMMIT" >/dev/null
git -C "$SUBMODULE_DIR" switch -C "$UPGRADE_BRANCH" >/dev/null

echo "Replaying ClawNet Besu patch stack onto $TARGET_REF"
echo "  source branch: $SOURCE_BRANCH"
echo "  old base:      $OLD_BASE_REF"
echo "  target:        $TARGET_REF"
echo "  upgrade branch:$UPGRADE_BRANCH"

set +e
git -C "$SUBMODULE_DIR" cherry-pick $PATCH_COMMITS
STATUS=$?
set -e

if [[ $STATUS -ne 0 ]]; then
  echo
  echo "Cherry-pick stopped with conflicts."
  echo "Resolve conflicts in: $SUBMODULE_DIR"
  echo "Then continue with: git -C $SUBMODULE_DIR cherry-pick --continue"
  echo "Or abort with:      git -C $SUBMODULE_DIR cherry-pick --abort"
  exit $STATUS
fi

echo
echo "Besu upgrade branch is ready."
echo "Next steps:"
echo "  1. Run focused Besu tests under Java 21"
echo "  2. Build the custom image"
echo "  3. Update infra/besu/README.md with the new fork commit, image tag, and digest"
echo "  4. Update the parent repo's submodule pointer after the fork commit is published"