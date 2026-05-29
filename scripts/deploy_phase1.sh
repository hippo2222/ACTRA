#!/usr/bin/env bash
# Phase 1 deployment helper for hetzner production server.
#
# Usage (on the server, after `ssh root@91.99.223.246`):
#   cd /path/to/repo
#   bash scripts/deploy_phase1.sh
#
# The script:
#   1. Confirms you are on the right branch.
#   2. Pulls the latest commit.
#   3. Rebuilds and restarts the `app` Docker service.
#   4. Waits for the container to be ready.
#   5. Runs a 6-check smoke test against https://actra.site.
#
# Aborts on any failure so you don't get a half-broken prod.

set -euo pipefail

REPO_DIR="${REPO_DIR:-$(pwd)}"
COMPOSE_FILES="-f docker-compose.hosted.yml"
BRANCH="online-hosting"
APP_CONTAINER="actra-app-1"
PUBLIC_BASE="${PUBLIC_BASE:-https://actra.site}"

cd "$REPO_DIR"

echo "==> Repo: $REPO_DIR"
echo ""

# ---- Step 1: Branch + clean tree check ---------------------------------------
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$current_branch" != "$BRANCH" ]]; then
    echo "ERROR: expected branch '$BRANCH', got '$current_branch'." >&2
    exit 1
fi
echo "==> On branch: $current_branch (OK)"
echo ""

# ---- Step 2: Pull --------------------------------------------------------------
echo "==> Fetching origin..."
git fetch origin "$BRANCH"

local_sha=$(git rev-parse HEAD)
remote_sha=$(git rev-parse "origin/$BRANCH")
echo "    local:  $local_sha"
echo "    remote: $remote_sha"
if [[ "$local_sha" == "$remote_sha" ]]; then
    echo "    Already up-to-date. Continuing anyway (will still rebuild)."
else
    echo "==> Pulling..."
    git pull --ff-only origin "$BRANCH"
fi
echo ""

# ---- Step 3: Rebuild and restart app ----------------------------------------
echo "==> Rebuilding 'app' container..."
docker compose $COMPOSE_FILES up -d --build app
echo ""

# ---- Step 4: Wait for container readiness -----------------------------------
echo "==> Waiting for $APP_CONTAINER to be ready (max 60s)..."
deadline=$((SECONDS + 60))
ready=0
while [[ $SECONDS -lt $deadline ]]; do
    if docker ps --filter "name=$APP_CONTAINER" --format '{{.Status}}' | grep -q "Up"; then
        # Container is Up; try health from host
        if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/welcome | grep -qE "200|301|302"; then
            ready=1
            break
        fi
    fi
    sleep 2
done

if [[ $ready -ne 1 ]]; then
    echo "ERROR: container did not become ready in 60s." >&2
    echo "Last 30 lines of logs:" >&2
    docker logs --tail 30 "$APP_CONTAINER" >&2
    exit 1
fi
echo "    Container is up and serving /welcome."
echo ""

# ---- Step 5: Production smoke checks -----------------------------------------
echo "==> Running smoke checks against $PUBLIC_BASE"
echo ""

fail_count=0

check() {
    local name="$1"
    local url="$2"
    local want_status="$3"
    local want_header_re="${4:-}"

    local out
    out=$(curl -sI "$url")
    local status
    status=$(printf '%s' "$out" | awk 'NR==1 {print $2}')

    local ok=1
    local notes=""

    if [[ "$status" != "$want_status" ]]; then
        ok=0
        notes="status=$status (want $want_status)"
    fi

    if [[ -n "$want_header_re" ]]; then
        if ! printf '%s' "$out" | grep -iE "$want_header_re" > /dev/null; then
            ok=0
            notes="$notes; missing header matching $want_header_re"
        fi
    fi

    if [[ $ok -eq 1 ]]; then
        echo "  [PASS] $name"
    else
        echo "  [FAIL] $name  ($notes)"
        echo "    URL: $url"
        echo "    Response head:"
        printf '%s\n' "$out" | sed 's/^/      /'
        fail_count=$((fail_count + 1))
    fi
}

check_body() {
    local name="$1"
    local url="$2"
    local must_contain="$3"

    local body
    body=$(curl -s "$url")
    if printf '%s' "$body" | grep -q "$must_contain"; then
        echo "  [PASS] $name"
    else
        echo "  [FAIL] $name (body does not contain: $must_contain)"
        echo "    URL: $url"
        echo "    Body length: ${#body}"
        echo "    Matches for canonical:"
        printf '%s' "$body" | grep 'canonical'
        fail_count=$((fail_count + 1))
    fi
}

check "/ welcome page returns 200"                      "$PUBLIC_BASE/"                                       "200"
check "/welcome redirects to /"                         "$PUBLIC_BASE/welcome"                                "301" "^location:[[:space:]]*\/[[:space:]]*$"
check "/welcome?test=1 preserves query string"          "$PUBLIC_BASE/welcome?test=1"                        "301" "^location:[[:space:]]*\/\\?test=1[[:space:]]*$"
check "/ui/main redirects to / (unauthenticated)"      "$PUBLIC_BASE/ui/main"                                "302" "^location:[[:space:]]*\/[[:space:]]*$"
check_body "/ has canonical=https://actra.site/"       "$PUBLIC_BASE/"                                       'href=.*actra\.site'
check_body "/sitemap.xml lists root /"                  "$PUBLIC_BASE/sitemap.xml"                            "<loc>https://actra.site/</loc>"
check "/ui/assets/MainLogic.js stays as 200 alias"      "$PUBLIC_BASE/ui/assets/MainLogic.js"                 "200"

echo ""
if [[ $fail_count -eq 0 ]]; then
    echo "==> All 7 smoke checks passed. Phase 1 deployed successfully."
else
    echo "==> $fail_count of 7 smoke checks FAILED. Review above and consider rollback:" >&2
    echo "      git revert HEAD && git push origin $BRANCH" >&2
    echo "      docker compose $COMPOSE_FILES up -d --build app" >&2
    exit 1
fi

