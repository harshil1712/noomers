#!/usr/bin/env bash
# Read-only check that CLOUDFLARE_API_TOKEN has every permission `alchemy deploy` needs,
# naming the missing ones (Cloudflare only answers "10000 Authentication error").
# Usage: cf-token-preflight.sh [zone-name]   (zone checks only when a zone is given)
set -uo pipefail
: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
API=https://api.cloudflare.com/client/v4
A=$CLOUDFLARE_ACCOUNT_ID
missing=0

check() { # <permission label> <path>
  local body
  body=$(curl -s -m 20 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API$2")
  if [ "$(jq -r '.success' <<<"$body" 2>/dev/null)" = "true" ]; then
    echo "ok       $1"
  else
    echo "MISSING  $1  ($(jq -r '[.errors[]? | "\(.code) \(.message)"] | join("; ")' <<<"$body" 2>/dev/null))"
    missing=1
  fi
}

check "token valid for account $A" "/accounts/$A/tokens/verify"
check "Account · Workers Scripts · Write" "/accounts/$A/workers/subdomain"
check "Account · D1 · Write" "/accounts/$A/d1/database"
check "Account · Workers R2 Storage · Write" "/accounts/$A/r2/buckets"
check "Account · Secrets Store · Write" "/accounts/$A/secrets_store/stores"
# Read probes: a GET proves read access to the area, not write — but these
# are the closest read-only checks for the permissions deploy needs.
check "Account · Pipelines · Write" "/accounts/$A/pipelines/v1/streams"
check "Account · Workers R2 Data Catalog · Write" "/accounts/$A/r2-catalog"
check "Account · Account API Tokens · Edit" "/accounts/$A/tokens"

if [ -n "${1:-}" ]; then
  zone=$(curl -s -m 20 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API/zones?name=$1" | jq -r '.result[0].id // empty')
  if [ -n "$zone" ]; then
    echo "ok       Zone $1 · Zone · Read"
    check "Zone $1 · Workers Routes · Write" "/zones/$zone/workers/routes"
    # www → apex redirect rule; a zone with no redirect ruleset yet answers 404 (not an auth error)
    body=$(curl -s -m 20 -w '\n%{http_code}' -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "$API/zones/$zone/rulesets/phases/http_request_dynamic_redirect/entrypoint")
    case "$(tail -n1 <<<"$body")" in
      200 | 404) echo "ok       Zone $1 · Dynamic URL Redirects · Edit" ;;
      *) echo "MISSING  Zone $1 · Dynamic URL Redirects · Edit  ($(sed '$d' <<<"$body" | jq -r '[.errors[]? | "\(.code) \(.message)"] | join("; ")' 2>/dev/null))"; missing=1 ;;
    esac
  else
    echo "MISSING  Zone $1 · Zone · Read"
    missing=1
  fi
fi

[ "$missing" = 0 ] || { echo "::error::Cloudflare API token is missing permissions (see above; docs/deploy.md)"; exit 1; }
