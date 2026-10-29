#!/usr/bin/env bash
set -euo pipefail

REQUIRED_ENV="KPM_OPERATOR_CONTACT KPM_HOST_PROVIDER KPM_HOST_COUNTRY KPM_HOST_REGION KPM_HOST_LOG_RETENTION"
SECRET_ENV="DATA_GO_KR_SERVICE_KEY KINDERGARTEN_API_KEY KPM_REMOTE_BEARER_TOKEN KPM_ALERT_WEBHOOK_URL"
KEY_ENV_ALL="DATA_GO_KR_SERVICE_KEY KINDERGARTEN_API_KEY LAW_OC SAFETYKOREA_AUTH_KEY KPM_REMOTE_BEARER_TOKEN KPM_ALERT_WEBHOOK_URL"
MODE_ENV="KPM_ORIGIN_POLICY KPM_HOST_REQUEST_LOGS"
RESERVED_ENV="PORT KPM_HTTP_PORT KPM_HTTP_HOST"

DEFAULT_REGION="asia-northeast3"
DEFAULT_SERVICE="korean-parenting-mcp"
DEFAULT_MODE="trial"

ENV_LINE_RE='^[A-Z][A-Z0-9_]*='
SECRET_SPEC_RE='^([A-Z][A-Z0-9_]*)=([^:]+):([^:]+)$'
SECRET_ID_RE='^[A-Za-z0-9_-]{1,255}$'
SECRET_VER_RE='^[1-9][0-9]*$'

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

PROJECT=""
ENV_FILE=""
REGION=""
SERVICE=""
MODE=""
ASSUME_YES=0
DRY_RUN=0
SECRET_SPECS=()
SECRET_NAMES=()
SECRET_REFS=()
ENV_NAMES=()
ENV_VALUES=()

say() {
  printf '%s\n' "$*" >&2
}

fail() {
  printf '%s\n' "$1" >&2
  exit 2
}

usage() {
  cat <<'EOF'
사용법:
  deploy/cloud-run/deploy.sh --project <PROJECT_ID> --env-file <PATH>
      [--region <REGION>] [--service <NAME>] [--mode trial|prod]
      [--secret NAME=SECRET_ID:VERSION]... [--yes] [--dry-run]

환경변수 대체값(해당 플래그가 없을 때만): CLOUD_RUN_PROJECT, CLOUD_RUN_REGION, CLOUD_RUN_SERVICE
기본값: 리전 asia-northeast3, 서비스 korean-parenting-mcp, 모드 trial
EOF
}

usage_fail() {
  usage >&2
  fail "$1"
}

in_list() {
  case " $2 " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

escape_yaml() {
  local v="$1"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '%s' "$v"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --project)
      [ $# -ge 2 ] || usage_fail "값이 필요합니다: --project"
      PROJECT="$2"
      shift 2
      ;;
    --env-file)
      [ $# -ge 2 ] || usage_fail "값이 필요합니다: --env-file"
      ENV_FILE="$2"
      shift 2
      ;;
    --region)
      [ $# -ge 2 ] || usage_fail "값이 필요합니다: --region"
      REGION="$2"
      shift 2
      ;;
    --service)
      [ $# -ge 2 ] || usage_fail "값이 필요합니다: --service"
      SERVICE="$2"
      shift 2
      ;;
    --mode)
      [ $# -ge 2 ] || usage_fail "값이 필요합니다: --mode"
      MODE="$2"
      shift 2
      ;;
    --secret)
      [ $# -ge 2 ] || usage_fail "값이 필요합니다: --secret"
      SECRET_SPECS+=("$2")
      shift 2
      ;;
    --yes)
      ASSUME_YES=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      usage_fail "알 수 없는 옵션입니다"
      ;;
  esac
done

if [ -z "$PROJECT" ]; then
  PROJECT="${CLOUD_RUN_PROJECT:-}"
fi
[ -n "$PROJECT" ] || usage_fail "--project 가 필요합니다(또는 CLOUD_RUN_PROJECT 설정)"

if [ -z "$REGION" ]; then
  REGION="${CLOUD_RUN_REGION:-$DEFAULT_REGION}"
fi
if [ -z "$SERVICE" ]; then
  SERVICE="${CLOUD_RUN_SERVICE:-$DEFAULT_SERVICE}"
fi

MODE="${MODE:-$DEFAULT_MODE}"
case "$MODE" in
  trial|prod) ;;
  *) usage_fail "--mode 는 trial 또는 prod 만 가능합니다" ;;
esac

[ -n "$ENV_FILE" ] || usage_fail "--env-file 이 필요합니다"
[ -f "$ENV_FILE" ] || fail "env 파일을 찾을 수 없습니다: $ENV_FILE"

if [ "$MODE" = "trial" ] && [ ${#SECRET_SPECS[@]} -gt 0 ]; then
  fail "시험 배포는 키 없이 합니다(--secret 불가)"
fi

for spec in "${SECRET_SPECS[@]+"${SECRET_SPECS[@]}"}"; do
  if ! [[ $spec =~ $SECRET_SPEC_RE ]]; then
    fail "--secret 형식 오류: NAME=SECRET_ID:VERSION"
  fi
  s_name="${BASH_REMATCH[1]}"
  s_id="${BASH_REMATCH[2]}"
  s_ver="${BASH_REMATCH[3]}"
  if ! in_list "$s_name" "$SECRET_ENV"; then
    fail "허용되지 않은 시크릿 이름: $s_name"
  fi
  if ! [[ $s_id =~ $SECRET_ID_RE ]]; then
    fail "시크릿 ID 형식 오류: $s_name"
  fi
  if ! [[ $s_ver =~ $SECRET_VER_RE ]]; then
    fail "시크릿 버전은 숫자로 고정해야 합니다: $s_name"
  fi
  SECRET_NAMES+=("$s_name")
  SECRET_REFS+=("$s_name=$s_id:$s_ver")
done

SEEN=" "
LINE_NO=0
while IFS= read -r line || [ -n "$line" ]; do
  LINE_NO=$((LINE_NO + 1))
  trimmed="${line//[[:space:]]/}"
  case "$trimmed" in
    ""|"#"*) continue ;;
  esac
  if ! [[ $line =~ $ENV_LINE_RE ]]; then
    fail "env 파일 형식 오류: $LINE_NO"
  fi
  name="${line%%=*}"
  value="${line#*=}"
  if in_list "$name" "$KEY_ENV_ALL"; then
    fail "비밀은 env 파일에 쓰지 말고 --secret 으로 Secret Manager 참조만 넘기세요: $name"
  fi
  if in_list "$name" "$MODE_ENV"; then
    fail "--mode 가 정하는 값입니다: $name"
  fi
  if in_list "$name" "$RESERVED_ENV"; then
    fail "플랫폼/컨테이너가 정하는 값입니다: $name"
  fi
  case "$value" in
    "<"*) fail "자리표시자 값이 남아 있음: $name" ;;
  esac
  if in_list "$name" "$SEEN"; then
    fail "중복된 변수입니다: $name"
  fi
  SEEN="$SEEN$name "
  ENV_NAMES+=("$name")
  ENV_VALUES+=("$value")
done < "$ENV_FILE"

for req in $REQUIRED_ENV; do
  if ! in_list "$req" "$SEEN"; then
    fail "필수 env 누락: $req"
  fi
done

HAS_ALLOWED_HOSTS=1
if ! in_list "KPM_ALLOWED_HOSTS" "$SEEN"; then
  HAS_ALLOWED_HOSTS=0
  say "KPM_ALLOWED_HOSTS 미설정 — 배포 후 표시되는 URL 호스트로 env 파일에 넣고 다시 실행하세요(그 전까지 모든 요청이 403)."
fi

if [ "$MODE" = "trial" ]; then
  ENV_NAMES+=("KPM_ORIGIN_POLICY" "KPM_HOST_REQUEST_LOGS")
  ENV_VALUES+=("report" "retained")
else
  ENV_NAMES+=("KPM_ORIGIN_POLICY" "KPM_HOST_REQUEST_LOGS")
  ENV_VALUES+=("strict" "excluded")
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir "$WORK/src"
for f in package.json package-lock.json tsconfig.json tsconfig.build.json Dockerfile .dockerignore; do
  cp "$REPO_ROOT/$f" "$WORK/src/$f"
done
cp -R "$REPO_ROOT/src" "$REPO_ROOT/data" "$WORK/src/"

: > "$WORK/env.yaml"
i=0
while [ "$i" -lt "${#ENV_NAMES[@]}" ]; do
  printf '%s: "%s"\n' "${ENV_NAMES[$i]}" "$(escape_yaml "${ENV_VALUES[$i]}")" >> "$WORK/env.yaml"
  i=$((i + 1))
done

FIXED_FLAGS="--max-instances=1 --min-instances=0 --concurrency=80 --cpu=1 --memory=512Mi --timeout=300 --cpu-throttling --allow-unauthenticated --ingress=all"

CMD=(gcloud run deploy "$SERVICE" --source "$WORK/src" --project "$PROJECT" --region "$REGION"
  --max-instances=1 --min-instances=0 --concurrency=80 --cpu=1 --memory=512Mi
  --timeout=300 --cpu-throttling --allow-unauthenticated --ingress=all
  --env-vars-file "$WORK/env.yaml")
if [ "$MODE" = "prod" ] && [ ${#SECRET_REFS[@]} -gt 0 ]; then
  joined=""
  for ref in "${SECRET_REFS[@]}"; do
    if [ -z "$joined" ]; then
      joined="$ref"
    else
      joined="$joined,$ref"
    fi
  done
  CMD+=(--set-secrets "$joined")
else
  CMD+=(--clear-secrets)
fi

say "배포 요약"
say "  프로젝트: $PROJECT"
say "  리전: $REGION"
say "  서비스: $SERVICE"
say "  모드: $MODE"
say "  고정 플래그: $FIXED_FLAGS"
i=0
while [ "$i" -lt "${#ENV_NAMES[@]}" ]; do
  say "  env: ${ENV_NAMES[$i]}=${ENV_VALUES[$i]}"
  i=$((i + 1))
done
for ref in "${SECRET_REFS[@]+"${SECRET_REFS[@]}"}"; do
  say "  시크릿: ${ref%%=*} → ${ref#*=}"
done
say "유료 설정(min-instances≥1, CPU 상시 할당, Cloud NAT)은 쓰지 않습니다"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%q ' "${CMD[@]}"
  printf '\n'
  exit 0
fi

if ! command -v gcloud >/dev/null 2>&1; then
  fail "gcloud CLI가 없습니다"
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    fail "비대화형 실행: --yes 가 필요합니다"
  fi
  ans=""
  read -r -p "위 설정으로 배포할까요? [y/N] " ans || ans=""
  case "$ans" in
    y|Y) ;;
    *)
      say "취소했습니다"
      exit 1
      ;;
  esac
fi

"${CMD[@]}"

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
printf '%s\n' "$URL"

if [ "$MODE" = "trial" ]; then
  EXPECT="allow"
else
  EXPECT="reject"
fi
say "다음 단계: npm run smoke:remote -- \"$URL\" --expect-origin $EXPECT"
if [ "$HAS_ALLOWED_HOSTS" -eq 0 ]; then
  say "KPM_ALLOWED_HOSTS 를 env 파일에 넣고 다시 실행하세요(배포 후 표시되는 URL 호스트)."
fi
