#!/usr/bin/env bash
# shellcheck disable=SC2016  # backticks in single quotes are Markdown code spans for issue and PR text
# Merges new commits of the upstream repository into SYNC_BRANCH and opens (or updates) a pull request into
# BASE_BRANCH. On a merge conflict it opens an issue with the steps to merge by hand instead.
# Run by .github/workflows/sync-upstream.yml; needs gh signed in through GH_TOKEN.
#
# SYNC_BRANCH belongs to this script: while no sync pull request is open, it is reset to BASE_BRANCH.
# Merge sync pull requests with "Create a merge commit". A squash or rebase merge leaves the upstream commits
# out of BASE_BRANCH's history, so the next run would offer them again.
set -euo pipefail

: "${UPSTREAM_URL:?}" "${UPSTREAM_BRANCH:?}" "${BASE_BRANCH:?}" "${SYNC_BRANCH:?}"
UPSTREAM_NAME=$(sed -E 's#^https://github.com/##; s#\.git$##' <<<"$UPSTREAM_URL")
UPSTREAM_REF="refs/remotes/upstream/$UPSTREAM_BRANCH"
CI_WORKFLOW=${CI_WORKFLOW:-ci.yml}

summary() {
    echo "$*"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$*" >>"$GITHUB_STEP_SUMMARY"; fi
}

# Pull requests opened with the workflow token do not trigger other workflows, except workflow_dispatch.
# Dispatching CI on the sync branch puts its check on the pull request.
run_ci() {
    if ! gh workflow run "$CI_WORKFLOW" --ref "$SYNC_BRANCH"; then
        echo "::warning::Could not start $CI_WORKFLOW on $SYNC_BRANCH; run it from the Actions tab."
    fi
}

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

git fetch --no-tags origin "+refs/heads/$BASE_BRANCH:refs/remotes/origin/$BASE_BRANCH"
git fetch --no-tags "$UPSTREAM_URL" "+refs/heads/$UPSTREAM_BRANCH:$UPSTREAM_REF"
upstream_sha=$(git rev-parse "$UPSTREAM_REF")
short_sha=${upstream_sha:0:7}

new_count=$(git rev-list --count "origin/$BASE_BRANCH..$UPSTREAM_REF")
if [ "$new_count" -eq 0 ]; then
    summary "Up to date: $BASE_BRANCH already contains $UPSTREAM_NAME@$short_sha."
    exit 0
fi

open_pr=$(gh pr list --head "$SYNC_BRANCH" --base "$BASE_BRANCH" --state open --json number --jq '.[0].number // empty')
if [ -n "$open_pr" ] && git fetch --no-tags origin "+refs/heads/$SYNC_BRANCH:refs/remotes/origin/$SYNC_BRANCH"; then
    # Build on the open pull request (it may hold someone's conflict fixes), never reset it.
    git checkout -q -B "$SYNC_BRANCH" "refs/remotes/origin/$SYNC_BRANCH"
    if git merge-base --is-ancestor "$upstream_sha" HEAD; then
        summary "Pull request #$open_pr already contains $UPSTREAM_NAME@$short_sha."
        exit 0
    fi
else
    open_pr=""
    git checkout -q -B "$SYNC_BRANCH" "refs/remotes/origin/$BASE_BRANCH"
fi

commit_list=$(git log --no-merges --format='- `%h` %s (%an, %as)' "HEAD..$UPSTREAM_REF" | head -n 50)
commit_count=$(git rev-list --no-merges --count "HEAD..$UPSTREAM_REF")
if [ "$commit_count" -gt 50 ]; then
    commit_list+=$'\n'"- ... and $((commit_count - 50)) more"
fi

if ! git merge --no-ff --no-edit -m "Merge $UPSTREAM_NAME@$short_sha into $SYNC_BRANCH" "$UPSTREAM_REF" >/dev/null; then
    conflicts=$(git diff --name-only --diff-filter=U | sed 's/^/- `/; s/$/`/')
    git merge --abort
    title="Upstream sync needs a manual merge"
    issue=$(gh issue list --state open --search "\"$title\" in:title" --json number --jq '.[0].number // empty')
    if [ -n "$issue" ] && gh issue view "$issue" --json body,comments --jq '[.body, .comments[].body] | join("\n")' | grep -q "$upstream_sha"; then
        summary "Merge conflict with $UPSTREAM_NAME@$short_sha; issue #$issue already reports it."
        exit 0
    fi
    body=$(cat <<EOF
Merging \`$UPSTREAM_NAME@$upstream_sha\` into \`$BASE_BRANCH\` conflicts in:

$conflicts

New upstream commits:

$commit_list

Merge by hand (Git Bash, in your clone):

\`\`\`bash
git fetch origin
git fetch $UPSTREAM_URL $UPSTREAM_BRANCH
git checkout -B $SYNC_BRANCH origin/$BASE_BRANCH
git merge FETCH_HEAD
# fix the files above, then:
git add .
git commit
npm test
git push --force origin $SYNC_BRANCH
\`\`\`

Then open a pull request \`$SYNC_BRANCH\` → \`$BASE_BRANCH\`, merge it with **Create a merge commit**, and close this issue.
EOF
)
    if [ -n "$issue" ]; then
        gh issue comment "$issue" --body "$body"
        summary "Merge conflict with $UPSTREAM_NAME@$short_sha; added it to issue #$issue."
    else
        gh issue create --title "$title" --body "$body"
        summary "Merge conflict with $UPSTREAM_NAME@$short_sha; opened an issue."
    fi
    exit 0
fi

if [ -n "$open_pr" ]; then
    git push origin "$SYNC_BRANCH"
    gh pr comment "$open_pr" --body "$(printf 'Merged more upstream commits (`%s`):\n\n%s' "$UPSTREAM_NAME@$short_sha" "$commit_list")"
    run_ci
    summary "Added $UPSTREAM_NAME@$short_sha to pull request #$open_pr."
    exit 0
fi

# No sync pull request is open, so the branch is a leftover of an earlier sync: replace it.
git push --force origin "$SYNC_BRANCH"
body=$(cat <<EOF
New commits from [$UPSTREAM_NAME](https://github.com/$UPSTREAM_NAME), up to \`$short_sha\`:

$commit_list

Changed: $(git diff --shortstat "refs/remotes/origin/$BASE_BRANCH...HEAD")

Before merging:
- [ ] CI is green (started automatically; also in the Actions tab).
- [ ] Changes to files this fork modified (\`src/pac.ts\`, \`src/serverClient.ts\`, \`src/ude.ts\`, \`package.json\`, \`NOTICE\`...) still keep its fixes.
- [ ] On a D365FO dev box if the server or build changed: \`npm run build\`, \`scripts/smoke-test.ps1\`.

Merge with **Create a merge commit**, not squash or rebase: otherwise the next sync offers these commits again.

_Opened by the Sync upstream workflow (\`.github/workflows/sync-upstream.yml\`)._
EOF
)
if ! output=$(gh pr create --base "$BASE_BRANCH" --head "$SYNC_BRANCH" \
    --title "Sync upstream: $commit_count new commit(s) from $UPSTREAM_NAME" --body "$body" 2>&1); then
    echo "$output" >&2
    if grep -qi 'not permitted to create' <<<"$output"; then
        echo "::error::Turn on Settings > Actions > General > Workflow permissions > 'Allow GitHub Actions to create and approve pull requests', then re-run this workflow."
    fi
    exit 1
fi
run_ci
summary "Opened $output"
