#!/usr/bin/env bash
# Live smoke test for the deployed DBReader cloud backend.
# Usage: ./smoke_test.sh https://<api-url>   (optionally pass ARCH x86_64 to use x64 zip)
set -euo pipefail

API="${1:?usage: smoke_test.sh <api-url>}"
BASE="$API/api/v1"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
pass() { printf '\033[1;32m  ok\033[0m\n'; }
fail() { printf '\033[1;31m  FAIL: %s\033[0m\n' "$*"; exit 1; }

check_status() { # check_status <expected> <actual> <label>
  [[ "$2" == "$1" ]] || fail "$3 (expected $1, got $2)"
}

ts() { date +%s%3N; }

JQ() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }

say "1. health"
CODE=$(curl -s -o /tmp/smoke_health.json -w '%{http_code}' "$BASE/health")
check_status 200 "$CODE" "health"

say "2. register owner + member"
EMAIL_O="owner.$(ts)@smoke.local"
EMAIL_M="member.$(ts)@smoke.local"
curl -s -X POST "$BASE/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_O\",\"name\":\"Owner\",\"password\":\"smoketest123\"}" > /tmp/smoke_o.json
TOKEN_O=$(JQ '["token"]' < /tmp/smoke_o.json)
[[ -n "$TOKEN_O" ]] || fail "owner token missing"
curl -s -X POST "$BASE/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_M\",\"name\":\"Member\",\"password\":\"smoketest123\"}" > /tmp/smoke_m.json
TOKEN_M=$(JQ '["token"]' < /tmp/smoke_m.json)
[[ -n "$TOKEN_M" ]] || fail "member token missing"

say "3. login wrong + right"
CODE=$(curl -s -o /tmp/smoke_l.json -w '%{http_code}' -X POST "$BASE/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_O\",\"password\":\"wrongpw\"}")
check_status 401 "$CODE" "login with wrong password rejected"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL_O\",\"password\":\"smoketest123\"}")
check_status 200 "$CODE" "login with correct password"

say "4. create team + /me"
curl -s -X POST "$BASE/team/create" -H "authorization: Bearer $TOKEN_O" -H 'content-type: application/json' \
  -d '{"name":"Smoke Team"}' > /tmp/smoke_team.json
TEAM_ID=$(JQ '["team_id"]' < /tmp/smoke_team.json)
CODE=$(JQ '["code"]' < /tmp/smoke_team.json)
[[ -n "$TEAM_ID" && -n "$CODE" ]] || fail "team create response incomplete"
curl -s "$BASE/me" -H "authorization: Bearer $TOKEN_O" > /tmp/smoke_me.json
N_TEAMS=$(JQ '["teams"] and len(["teams"])' < /tmp/smoke_me.json 2>/dev/null || python3 -c "import json;print(len(json.load(open('/tmp/smoke_me.json'))['teams']))")
[[ "$N_TEAMS" == "1" ]] || fail "/me teams count ($N_TEAMS)"

say "5. member joins via code"
CODE=$(curl -s -o /tmp/smoke_join.json -w '%{http_code}' -X POST "$BASE/team/join" \
  -H "authorization: Bearer $TOKEN_M" -H 'content-type: application/json' -d "{\"code\":\"$CODE\"}")
check_status 200 "$CODE" "join"
ROLE=$(JQ '["role"]' < /tmp/smoke_join.json)
[[ "$ROLE" == "full" ]] || fail "join role ($ROLE)"

say "6. publish file -> presigned PUT to S3"
curl -s -X POST "$BASE/files/upload-url" -H "authorization: Bearer $TOKEN_O" -H 'content-type: application/json' \
  -d "{\"team_id\":\"$TEAM_ID\",\"name\":\"smoke.db\"}" > /tmp/smoke_up.json
FILE_ID=$(JQ '["file_id"]' < /tmp/smoke_up.json)
PUT_URL=$(JQ '["upload_url"]' < /tmp/smoke_up.json)
[[ -n "$FILE_ID" && "$PUT_URL" == https://* ]] || fail "upload-url response incomplete"
printf 'smoke-test-content-12345' > /tmp/smoke.db
CODE=$(curl -s -o /tmp/smoke_put.txt -w '%{http_code}' -X PUT "$PUT_URL" --data-binary @/tmp/smoke.db)
check_status 200 "$CODE" "S3 PUT via presigned url (body: $(head -c 120 /tmp/smoke_put.txt))"
SIZE=$(stat -f%z /tmp/smoke.db)
CODE=$(curl -s -o /tmp/smoke_conf.json -w '%{http_code}' -X POST "$BASE/files/confirm" \
  -H "authorization: Bearer $TOKEN_O" -H 'content-type: application/json' \
  -d "{\"team_id\":\"$TEAM_ID\",\"file_id\":\"$FILE_ID\",\"size\":$SIZE}")
check_status 200 "$CODE" "confirm"

say "7. owner push op"
OP='{"site":"mac-a","seq":1,"hlc":"260800000000.001","table":"products","pk":{"id":1},"row":{"name":"wine"},"op":"upsert"}'
CODE=$(curl -s -o /tmp/smoke_push.json -w '%{http_code}' -X POST "$BASE/push" \
  -H "authorization: Bearer $TOKEN_O" -H 'content-type: application/json' \
  -d "{\"team_id\":\"$TEAM_ID\",\"file_id\":\"$FILE_ID\",\"site\":\"mac-a\",\"schema\":\"k1\",\"ops\":[$OP]}")
check_status 200 "$CODE" "push"

say "8. member pull (long-poll wait=2000)"
CODE=$(curl -s -o /tmp/smoke_pull.json -w '%{http_code}' \
  "$BASE/pull?team_id=$TEAM_ID&file_id=$FILE_ID&site=&h=&seq=0&wait=2000" \
  -H "authorization: Bearer $TOKEN_M")
check_status 200 "$CODE" "pull"
N_OPS=$(python3 -c "import json;print(len(json.load(open('/tmp/smoke_pull.json'))['ops']))")
[[ "$N_OPS" -ge 1 ]] || fail "pull ops count ($N_OPS)"
SCHEMA=$(python3 -c "import json;print(json.load(open('/tmp/smoke_pull.json'))['schema'])")
[[ "$SCHEMA" == "k1" ]] || fail "pull schema ($SCHEMA)"

say "9. role demote: member push -> 403"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/team/members" \
  -H "authorization: Bearer $TOKEN_O" -H 'content-type: application/json' \
  -d "{\"team_id\":\"$TEAM_ID\",\"email\":\"$EMAIL_M\",\"role\":\"viewer\"}")
check_status 200 "$CODE" "set viewer"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/push" \
  -H "authorization: Bearer $TOKEN_M" -H 'content-type: application/json' \
  -d "{\"team_id\":\"$TEAM_ID\",\"file_id\":\"$FILE_ID\",\"site\":\"tab\",\"ops\":[$OP]}")
check_status 403 "$CODE" "viewer push rejected"

say "10. code rotate: member 403, owner 200"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/code/rotate" \
  -H "authorization: Bearer $TOKEN_M" -H 'content-type: application/json' -d "{\"team_id\":\"$TEAM_ID\"}")
check_status 403 "$CODE" "member rotate rejected"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/code/rotate" \
  -H "authorization: Bearer $TOKEN_O" -H 'content-type: application/json' -d "{\"team_id\":\"$TEAM_ID\"}")
check_status 200 "$CODE" "owner rotate"

say "11. download presigned GET"
curl -s -X POST "$BASE/files/download" -H "authorization: Bearer $TOKEN_O" -H 'content-type: application/json' \
  -d "{\"team_id\":\"$TEAM_ID\",\"file_id\":\"$FILE_ID\"}" > /tmp/smoke_dl.json
DL_URL=$(JQ '["download_url"]' < /tmp/smoke_dl.json 2>/dev/null || python3 -c "import json;print(json.load(open('/tmp/smoke_dl.json'))['download_url'])")
CODE=$(curl -s -o /tmp/smoke_dl.db -w '%{http_code}' "$DL_URL")
check_status 200 "$CODE" "S3 GET via presigned url"
cmp -s /tmp/smoke.db /tmp/smoke_dl.db || fail "downloaded bytes differ"

say "12. auth guard: no token -> 401"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/me")
check_status 401 "$CODE" "unauthenticated /me"

echo
echo "======================================================================"
echo " ALL SMOKE TESTS PASSED"
echo "======================================================================"
