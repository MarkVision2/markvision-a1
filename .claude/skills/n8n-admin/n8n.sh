#!/usr/bin/env bash
# n8n-admin: thin curl wrapper around n8n Public REST API.
# Usage: bash .claude/skills/n8n-admin/n8n.sh <command> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
ENV_FILE="${N8N_ENV_FILE:-$SCRIPT_DIR/../../n8n.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${N8N_BASE_URL:?N8N_BASE_URL not set (expected in $ENV_FILE)}"
: "${N8N_API_KEY:?N8N_API_KEY not set (expected in $ENV_FILE)}"

API="${N8N_BASE_URL%/}/api/v1"
UA="n8n-admin-skill/1.0"

die() { echo "ERROR: $*" >&2; exit 1; }
have_jq() { command -v jq >/dev/null 2>&1; }

# request <METHOD> <PATH> [BODY-FILE-OR-JSON]
# Prints body. Exits non-zero on HTTP >= 400 with body on stderr.
request() {
  local method="$1" path="$2" body="${3:-}"
  local url="$API$path"
  local tmp; tmp="$(mktemp)"
  local code

  local -a args=(
    -sS
    -X "$method"
    -H "X-N8N-API-KEY: $N8N_API_KEY"
    -H "accept: application/json"
    -H "User-Agent: $UA"
    -o "$tmp"
    -w "%{http_code}"
  )

  if [[ -n "$body" ]]; then
    args+=(-H "content-type: application/json")
    if [[ -f "$body" ]]; then
      args+=(--data-binary "@$body")
    else
      args+=(--data-binary "$body")
    fi
  fi

  code="$(curl "${args[@]}" "$url" || echo "000")"

  if [[ "$code" -ge 400 || "$code" == "000" ]]; then
    echo "HTTP $code  $method $path" >&2
    cat "$tmp" >&2
    echo >&2
    rm -f "$tmp"
    return 1
  fi

  cat "$tmp"
  rm -f "$tmp"
}

# Build query string from --key value pairs. Echoes "?k=v&..." or empty.
build_query() {
  local q=""
  while [[ $# -gt 0 ]]; do
    local k="${1#--}" v="${2:-}"
    [[ -z "$v" ]] && shift && continue
    # URL-encode value (basic)
    local enc
    enc="$(printf '%s' "$v" | jq -sRr @uri 2>/dev/null || printf '%s' "$v")"
    q+="${q:+&}${k}=${enc}"
    shift 2 || shift
  done
  [[ -n "$q" ]] && echo "?$q" || echo ""
}

# Strip read-only fields before PUT/POST that n8n rejects.
strip_workflow_payload() {
  local file="$1"
  jq 'del(
    .id, .active, .createdAt, .updatedAt, .versionId, .triggerCount,
    .tags, .meta, .scopes, .shared, .isArchived, .parentFolderId,
    .homeProject, .staticData, .pinData
  )' "$file"
}

# ---------- commands ----------

cmd_help() {
  cat <<'HELP'
n8n-admin — управление n8n через REST API

Workflows:
  list-workflows [--active true|false] [--tags csv] [--name SUBSTR] [--projectId ID] [--limit N] [--cursor C]
  get-workflow <id>
  create-workflow <file.json>
  update-workflow <id> <file.json>            (PUT, выкидывает read-only поля)
  delete-workflow <id>
  activate <id>
  deactivate <id>
  transfer-workflow <id> <destinationProjectId>
  get-workflow-tags <id>
  set-workflow-tags <id> <tagId1> [tagId2...]

Executions:
  list-executions [--workflowId ID] [--status success|error|waiting] [--includeData true] [--limit N] [--cursor C]
  get-execution <id> [--include-data]
  delete-execution <id>

Credentials:
  list-credentials-schema <type>              (например: openAiApi)
  create-credential <file.json>
  delete-credential <id>
  transfer-credential <id> <destinationProjectId>

Tags:
  list-tags [--limit N] [--cursor C]
  create-tag <name>
  get-tag <id>
  update-tag <id> <name>
  delete-tag <id>

Users:
  list-users [--limit N] [--includeRole true]
  get-user <idOrEmail>
  create-user <email> <role>                  (role: global:member | global:admin)
  delete-user <idOrEmail>
  update-user-role <idOrEmail> <newRole>

Projects:
  list-projects [--limit N]
  create-project <name>
  update-project <id> <name>
  delete-project <id>
  add-user-to-project <projectId> <userId> <role>     (role: project:viewer|editor|admin)
  remove-user-from-project <projectId> <userId>
  change-user-role-in-project <projectId> <userId> <role>

Variables:
  list-variables [--limit N]
  create-variable <key> <value>
  delete-variable <id>

Audit:
  audit [<categories.json>]                   (POST /audit; body опционален)

Source control:
  source-control-pull [--force true]

Низкоуровневое:
  raw <METHOD> <PATH> [body.json | json-string]
  whoami                                      (быстрая проверка ключа)

Примеры:
  bash .claude/skills/n8n-admin/n8n.sh list-workflows --active true --limit 5
  bash .claude/skills/n8n-admin/n8n.sh get-workflow jwAukEEjmcagfWp0 > /tmp/wf.json
  bash .claude/skills/n8n-admin/n8n.sh update-workflow jwAukEEjmcagfWp0 /tmp/wf.json
  bash .claude/skills/n8n-admin/n8n.sh activate jwAukEEjmcagfWp0
  bash .claude/skills/n8n-admin/n8n.sh raw GET /workflows?limit=1
HELP
}

cmd_whoami() {
  # n8n не отдаёт /me на public API, но /users список доступен только админу — попробуем оба.
  if request GET "/workflows?limit=1" >/dev/null 2>&1; then
    echo "OK — API key валиден, базовые запросы проходят."
  else
    die "API key не работает или сеть блокирует $N8N_BASE_URL"
  fi
}

# ---- Workflows
cmd_list-workflows()    { local q; q="$(build_query "$@")"; request GET "/workflows$q"; }
cmd_get-workflow()      { [[ $# -ge 1 ]] || die "usage: get-workflow <id>"; request GET "/workflows/$1"; }
cmd_create-workflow()   { [[ $# -ge 1 && -f "$1" ]] || die "usage: create-workflow <file.json>"; request POST "/workflows" "$1"; }
cmd_update-workflow() {
  [[ $# -ge 2 && -f "$2" ]] || die "usage: update-workflow <id> <file.json>"
  have_jq || die "jq is required"
  local clean; clean="$(mktemp)"
  strip_workflow_payload "$2" > "$clean"
  request PUT "/workflows/$1" "$clean"
  rm -f "$clean"
}
cmd_delete-workflow()      { [[ $# -ge 1 ]] || die "usage: delete-workflow <id>"; request DELETE "/workflows/$1"; }
cmd_activate()             { [[ $# -ge 1 ]] || die "usage: activate <id>";   request POST "/workflows/$1/activate"; }
cmd_deactivate()           { [[ $# -ge 1 ]] || die "usage: deactivate <id>"; request POST "/workflows/$1/deactivate"; }
cmd_transfer-workflow()    { [[ $# -ge 2 ]] || die "usage: transfer-workflow <id> <destProjectId>"; request PUT "/workflows/$1/transfer" "{\"destinationProjectId\":\"$2\"}"; }
cmd_get-workflow-tags()    { [[ $# -ge 1 ]] || die "usage: get-workflow-tags <id>"; request GET "/workflows/$1/tags"; }
cmd_set-workflow-tags() {
  [[ $# -ge 2 ]] || die "usage: set-workflow-tags <id> <tagId1> [tagId2...]"
  local id="$1"; shift
  have_jq || die "jq is required"
  local payload; payload="$(printf '%s\n' "$@" | jq -R '{id: .}' | jq -s .)"
  request PUT "/workflows/$id/tags" "$payload"
}

# ---- Executions
cmd_list-executions() { local q; q="$(build_query "$@")"; request GET "/executions$q"; }
cmd_get-execution() {
  [[ $# -ge 1 ]] || die "usage: get-execution <id> [--include-data]"
  local id="$1"; shift || true
  local q=""
  [[ "${1:-}" == "--include-data" ]] && q="?includeData=true"
  request GET "/executions/$id$q"
}
cmd_delete-execution() { [[ $# -ge 1 ]] || die "usage: delete-execution <id>"; request DELETE "/executions/$1"; }

# ---- Credentials
cmd_list-credentials-schema() { [[ $# -ge 1 ]] || die "usage: list-credentials-schema <type>"; request GET "/credentials/schema/$1"; }
cmd_create-credential()       { [[ $# -ge 1 && -f "$1" ]] || die "usage: create-credential <file.json>"; request POST "/credentials" "$1"; }
cmd_delete-credential()       { [[ $# -ge 1 ]] || die "usage: delete-credential <id>"; request DELETE "/credentials/$1"; }
cmd_transfer-credential()     { [[ $# -ge 2 ]] || die "usage: transfer-credential <id> <destProjectId>"; request PUT "/credentials/$1/transfer" "{\"destinationProjectId\":\"$2\"}"; }

# ---- Tags
cmd_list-tags()   { local q; q="$(build_query "$@")"; request GET "/tags$q"; }
cmd_create-tag()  { [[ $# -ge 1 ]] || die "usage: create-tag <name>"; request POST "/tags" "{\"name\":\"$1\"}"; }
cmd_get-tag()     { [[ $# -ge 1 ]] || die "usage: get-tag <id>"; request GET "/tags/$1"; }
cmd_update-tag()  { [[ $# -ge 2 ]] || die "usage: update-tag <id> <name>"; request PUT "/tags/$1" "{\"name\":\"$2\"}"; }
cmd_delete-tag()  { [[ $# -ge 1 ]] || die "usage: delete-tag <id>"; request DELETE "/tags/$1"; }

# ---- Users
cmd_list-users()   { local q; q="$(build_query "$@")"; request GET "/users$q"; }
cmd_get-user()     { [[ $# -ge 1 ]] || die "usage: get-user <idOrEmail>"; request GET "/users/$1"; }
cmd_create-user()  {
  [[ $# -ge 2 ]] || die "usage: create-user <email> <role>"
  request POST "/users" "[{\"email\":\"$1\",\"role\":\"$2\"}]"
}
cmd_delete-user()        { [[ $# -ge 1 ]] || die "usage: delete-user <idOrEmail>"; request DELETE "/users/$1"; }
cmd_update-user-role()   { [[ $# -ge 2 ]] || die "usage: update-user-role <idOrEmail> <newRole>"; request PATCH "/users/$1/role" "{\"newRoleName\":\"$2\"}"; }

# ---- Projects
cmd_list-projects()    { local q; q="$(build_query "$@")"; request GET "/projects$q"; }
cmd_create-project()   { [[ $# -ge 1 ]] || die "usage: create-project <name>"; request POST "/projects" "{\"name\":\"$1\"}"; }
cmd_update-project()   { [[ $# -ge 2 ]] || die "usage: update-project <id> <name>"; request PUT "/projects/$1" "{\"name\":\"$2\"}"; }
cmd_delete-project()   { [[ $# -ge 1 ]] || die "usage: delete-project <id>"; request DELETE "/projects/$1"; }
cmd_add-user-to-project() {
  [[ $# -ge 3 ]] || die "usage: add-user-to-project <projectId> <userId> <role>"
  request POST "/projects/$1/users" "{\"relations\":[{\"userId\":\"$2\",\"role\":\"$3\"}]}"
}
cmd_remove-user-from-project()      { [[ $# -ge 2 ]] || die "usage: remove-user-from-project <projectId> <userId>"; request DELETE "/projects/$1/users/$2"; }
cmd_change-user-role-in-project()   { [[ $# -ge 3 ]] || die "usage: change-user-role-in-project <projectId> <userId> <role>"; request PATCH "/projects/$1/users/$2" "{\"role\":\"$3\"}"; }

# ---- Variables
cmd_list-variables()   { local q; q="$(build_query "$@")"; request GET "/variables$q"; }
cmd_create-variable()  {
  [[ $# -ge 2 ]] || die "usage: create-variable <key> <value>"
  have_jq || die "jq is required"
  request POST "/variables" "$(jq -n --arg k "$1" --arg v "$2" '{key:$k,value:$v}')"
}
cmd_delete-variable()  { [[ $# -ge 1 ]] || die "usage: delete-variable <id>"; request DELETE "/variables/$1"; }

# ---- Audit & Source control
cmd_audit() {
  if [[ $# -ge 1 && -f "$1" ]]; then
    request POST "/audit" "$1"
  else
    request POST "/audit" "{}"
  fi
}
cmd_source-control-pull() { local q; q="$(build_query "$@")"; request POST "/source-control/pull$q"; }

# ---- Raw escape hatch
cmd_raw() {
  [[ $# -ge 2 ]] || die "usage: raw <METHOD> <PATH> [body.json | json-string]"
  local method="$1" path="$2" body="${3:-}"
  request "$method" "$path" "$body"
}

# ---- dispatch ----
main() {
  local cmd="${1:-help}"; shift || true
  local fn="cmd_${cmd}"
  if declare -F "$fn" >/dev/null; then
    "$fn" "$@"
  else
    echo "Unknown command: $cmd" >&2
    cmd_help
    exit 1
  fi
}

main "$@"
