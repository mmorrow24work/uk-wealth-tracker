#!/bin/bash
# Sweeps every open PR and re-syncs any that have gone CONFLICTING against
# main, rather than relying solely on the one-time sync that happens when a
# PR is first created. docs/journal.md is appended to by every single PR, so
# in practice almost every open PR goes CONFLICTING the moment any other PR
# merges -- with several PRs open at once and merges landing every few
# minutes, PRs that already have auto-merge enabled and green checks were
# observed sitting unmerged indefinitely because nothing ever revisited them.
# This step runs unconditionally at the start of every pipeline invocation
# (which itself re-triggers on every merge) so the backlog self-clears within
# a run or two instead of requiring manual intervention.
set -uo pipefail

REPO="${GITHUB_REPOSITORY:?}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

git config user.name "claude-build-pipeline"
git config user.email "actions@users.noreply.github.com"
git fetch origin main -q

prs=$(gh pr list --repo "$REPO" --state open --json number,headRefName,mergeable,body)
conflicting=$(echo "$prs" | jq -c '[.[] | select(.mergeable == "CONFLICTING")]')
count=$(echo "$conflicting" | jq 'length')

if [ "$count" -eq 0 ]; then
  echo "No open PRs are CONFLICTING with main -- nothing to resync."
  exit 0
fi

echo "Found $count open PR(s) CONFLICTING with main -- resyncing each."

echo "$conflicting" | jq -c '.[]' | while read -r pr; do
  number=$(echo "$pr" | jq -r '.number')
  branch=$(echo "$pr" | jq -r '.headRefName')
  body=$(echo "$pr" | jq -r '.body')
  issue=$(echo "$body" | grep -oiE 'closes #[0-9]+' | head -1 | grep -oE '[0-9]+')

  echo "########## PR #$number ($branch), closes issue #${issue:-unknown} ##########"

  git merge --abort 2>/dev/null
  git checkout main -q
  git fetch origin "$branch" -q
  git checkout -q -B "$branch" "origin/$branch"

  resolved=true
  if ! git merge origin/main --no-commit --no-ff -q 2>/tmp/merge.log; then
    conflicted=$(git diff --name-only --diff-filter=U)
    echo "Conflicted files: $conflicted"

    if [ "$conflicted" = "docs/journal.md" ]; then
      echo "Only docs/journal.md conflicts -- auto-resolving as an append-only log."
      git show :2:docs/journal.md > /tmp/journal.ours.md
      git show :3:docs/journal.md > /tmp/journal.theirs.md
      git show origin/main:.github/scripts/resolve-journal-conflict.py > /tmp/resolve-journal-conflict.py
      python3 /tmp/resolve-journal-conflict.py
      if grep -q "<<<<<<<" docs/journal.md; then
        echo "Auto-resolution left conflict markers -- treating as unresolvable."
        resolved=false
      else
        git add docs/journal.md
        git commit -q -m "Merge main into $branch, auto-resolve docs/journal.md conflict"
      fi
    else
      echo "Real conflicts beyond docs/journal.md -- cannot auto-resolve."
      resolved=false
    fi

    if [ "$resolved" = "false" ]; then
      git merge --abort 2>/dev/null || git reset --hard HEAD -q
    fi
  else
    echo "Clean merge (or already up to date)."
  fi

  push_raced=false
  if [ "$resolved" = "true" ]; then
    npm ci --no-audit --no-fund -q
    if npm run build -q && npm run lint -q && npm run check -q && npm test -q; then
      rm -rf build .svelte-kit
      if git push "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" "HEAD:$branch"; then
        echo "PR #$number resynced and pushed."
      else
        # Remote moved between our fetch and our push -- almost always another
        # concurrent invocation of this same script (e.g. the pipeline's own
        # run overlapping a manual one) already resynced this branch. Not our
        # merge/verification's fault, so don't close the PR over it -- just
        # leave it for the next sweep to re-evaluate against the new state.
        echo "Push rejected (remote branch moved under us) -- leaving PR #$number for the next sweep."
        push_raced=true
      fi
    else
      echo "Post-merge verification failed -- not pushing a broken merge."
      resolved=false
    fi
  fi

  if [ "$resolved" = "false" ] && [ "$push_raced" = "false" ]; then
    gh pr close --repo "$REPO" "$number" --comment "Closing automatically -- this branch has diverged too far from main to merge safely (real conflicts beyond docs/journal.md, or the auto-resolved merge failed local build/lint/check/test verification). Re-queuing issue #${issue:-unknown} for a fresh implementation against current main."
    if [ -n "$issue" ]; then
      gh issue edit --repo "$REPO" "$issue" --remove-label "status:in-progress" --add-label "status:ready"
    fi
  fi
done

git checkout main -q
