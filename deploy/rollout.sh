#!/usr/bin/env bash
# Zero-downtime release of the 潮池 app image (see deploy/README.md).
#
#   deploy/rollout.sh [--build | --load <image.tar>] [--force] <tag>
#
#   --build        docker build the current checkout as <repo>:<tag>
#   --load <file>  docker load an image archive that contains <repo>:<tag>
#   (neither)      use <repo>:<tag> if it exists locally, otherwise docker pull it
#   --force        roll even if every service already runs <tag>
#
# Steps
#   1. point CHAOCHI_IMAGE (default chaochi/app:latest) at <repo>:<tag>
#   2. run migrations (one-shot `migrate`); the old release keeps serving meanwhile
#   3. web-a, then web-b: drain it (new connections refused, so the proxy sends them to the other
#      replica; running requests finish), recreate it on the new image, wait until Docker reports it
#      healthy AND the proxy routes requests to it; only then touch the other replica
#   4. recreate the worker (it finishes active jobs first), then reload the proxy config gracefully
# On failure it stops, leaves the healthy replica serving, moves CHAOCHI_IMAGE back to the previous
# image, and prints how to roll back. Re-running with the same tag is a no-op unless --force.
set -euo pipefail

usage() { sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 64; }

BUILD=0 LOAD_FILE="" FORCE=0 TAG=""
while (($#)); do
  case $1 in
    --build) BUILD=1 ;;
    --load) LOAD_FILE=${2:?--load needs a file}; shift ;;
    --force) FORCE=1 ;;
    -h | --help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) [[ -z $TAG ]] || usage; TAG=$1 ;;
  esac
  shift
done
[[ -n $TAG ]] || usage
[[ $TAG =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || { echo "invalid tag: $TAG" >&2; exit 64; }

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# Optional non-secret overrides (CHAOCHI_SUBNET, COMPOSE_PROJECT_NAME, ...), plain KEY=value lines.
DEPLOY_CONF=${CHAOCHI_DEPLOY_CONF:-/opt/chaochi/deploy.conf}
# shellcheck disable=SC1090
if [[ -f $DEPLOY_CONF ]]; then set -a; . "$DEPLOY_CONF"; set +a; fi

POINTER=${CHAOCHI_IMAGE:-chaochi/app:latest}
export CHAOCHI_IMAGE=$POINTER
if [[ ! $POINTER =~ ^(.+):([A-Za-z0-9_][A-Za-z0-9_.-]*)$ ]]; then
  echo "CHAOCHI_IMAGE must name a tag, e.g. chaochi/app:latest (got $POINTER)" >&2
  exit 64
fi
REPO=${CHAOCHI_IMAGE_REPO:-${BASH_REMATCH[1]}}
TARGET=$REPO:$TAG
[[ $TARGET != "$POINTER" ]] || { echo "<tag> must differ from the pointer tag in CHAOCHI_IMAGE ($POINTER)" >&2; exit 64; }

ENV_FILE=${CHAOCHI_ENV_FILE:-/opt/chaochi/app-env}
STATE_DIR=${CHAOCHI_STATE_DIR:-/opt/chaochi/state}
DOMAIN=${CHAOCHI_DOMAIN:-sparxie.moe}
HTTPS_PORT=${CHAOCHI_HTTPS_PORT:-443}
PROBE_ADDR=${CHAOCHI_PROBE_ADDR:-127.0.0.1}
HEALTH_TIMEOUT=${CHAOCHI_HEALTH_TIMEOUT:-120}
ROUTE_TIMEOUT=${CHAOCHI_ROUTE_TIMEOUT:-60}
STARTED=$SECONDS

log() { printf '%s  %s\n' "$(date +%H:%M:%S)" "$*"; }
step() { printf '\n%s  == %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '%s  FAILED: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }
dc() { docker compose "$@"; }

# These helpers never fail: a container can disappear between two calls while compose recreates it.
cid_of() { { dc ps -aq "$1" 2>/dev/null || true; } | head -n1; }
state_of() { # healthy | unhealthy | starting | running | exited | ... | missing
  local id; id=$(cid_of "$1")
  [[ -n $id ]] || { echo missing; return 0; }
  docker inspect -f '{{if and .State.Running .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$id" 2>/dev/null || echo missing
}
image_of() { local id; id=$(cid_of "$1"); [[ -z $id ]] || docker inspect -f '{{.Image}}' "$id" 2>/dev/null || true; }
ip_of() { local id; id=$(cid_of "$1"); [[ -z $id ]] || docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$id" 2>/dev/null || true; }
tags_of() { docker image inspect -f '{{join .RepoTags " "}}' "$1" 2>/dev/null | tr ' ' '\n' | grep -vxF "$POINTER" | grep -v '^$' || true; }
other_of() { [[ $1 == web-a ]] && echo web-b || echo web-a; }

# Which upstream did the proxy pick? Caddy adds X-Chaochi-Upstream for loopback clients only.
probe_upstream() {
  { curl -sk --max-time 3 -o /dev/null -D - --resolve "$DOMAIN:$HTTPS_PORT:$PROBE_ADDR" \
    "https://$DOMAIN:$HTTPS_PORT/api/health" 2>/dev/null || true; } |
    tr -d '\r' | awk -F': ' 'tolower($1) == "x-chaochi-upstream" { print $2 }'
}

wait_healthy() {
  local svc=$1 deadline=$((SECONDS + HEALTH_TIMEOUT)) st="" last=""
  while ((SECONDS < deadline)); do
    st=$(state_of "$svc")
    case $st in
      healthy) log "$svc: Docker health is healthy"; return 0 ;;
      unhealthy | exited | dead | missing) break ;;
    esac
    [[ $st == "$last" ]] || log "$svc: $st"
    last=$st
    sleep 1
  done
  log "$svc: state '$st'; last health check output:"
  docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}{{.ExitCode}} {{.Output}}{{end}}{{end}}' "$(cid_of "$svc")" 2>/dev/null | tail -n 3 >&2 || true
  dc logs --no-color --tail 30 "$svc" >&2 || true
  return 1
}

wait_routed() {
  local svc=$1 want deadline=$((SECONDS + ROUTE_TIMEOUT)) got="" n=0
  want="$(ip_of "$svc"):3000"
  while ((SECONDS < deadline)); do
    got=$(probe_upstream)
    n=$((n + 1))
    if [[ $got == "$want" ]]; then log "$svc: proxy routes to it ($want, probe $n)"; return 0; fi
    sleep 0.5
  done
  log "$svc: the proxy never picked $want in ${ROUTE_TIMEOUT}s (last upstream: '${got:-none}')"
  local code
  code=$(dc exec -T "$svc" bun -e \
    "const r = await fetch('http://127.0.0.1:3000/api/health'); console.log(r.status)" 2>/dev/null || echo '?')
  log "$svc: its own /api/health answers $code (the proxy routes only on 2xx; a 404 means this build has no health route)"
  return 1
}

# Drain a replica before it gets SIGTERM, so no request races its shutdown. Inside the container's
# network namespace, new TCP connections to :3000 are answered with a reset. The proxy treats that as a
# refused connection and retries the request on the other replica, whatever the method, and its health
# check takes the replica out. Requests already running finish; then we wait for their connections to
# close (the proxy uses one connection per request). The rule lives and dies with the old container.
DRAIN=${CHAOCHI_DRAIN:-1}
DRAIN_TIMEOUT=${CHAOCHI_DRAIN_TIMEOUT:-30}
DRAINED_PID=""
drain() {
  local svc=$1 pid deadline n=0
  ((DRAIN)) || { log "$svc: drain disabled (CHAOCHI_DRAIN=0); relying on proxy retries"; return 0; }
  pid=$(docker inspect -f '{{.State.Pid}}' "$(cid_of "$svc")" 2>/dev/null || echo 0)
  [[ $pid != 0 ]] || { log "$svc: not running, nothing to drain"; return 0; }
  nsenter --target "$pid" --net nft -f - <<'EOF'
table inet chaochi_drain {
  chain input {
    type filter hook input priority -10; policy accept;
    iif "lo" accept
    tcp dport 3000 ct state new reject with tcp reset
  }
}
EOF
  DRAINED_PID=$pid
  deadline=$((SECONDS + DRAIN_TIMEOUT))
  while ((SECONDS < deadline)); do
    n=$({ nsenter --target "$pid" --net ss -Htn state established '( sport = :3000 )' 2>/dev/null || true; } |
      awk '$4 !~ /^127\./' | wc -l)
    ((n > 0)) || break
    sleep 0.2
  done
  log "$svc: drained (new connections refused, $n still open)"
}
undrain() { # only needed when a rollout stops between drain and recreate
  [[ -n $DRAINED_PID ]] || return 0
  nsenter --target "$DRAINED_PID" --net nft delete table inet chaochi_drain 2>/dev/null || true
  DRAINED_PID=""
}

proxy_running() { [[ $(state_of proxy) == running ]]; }
ensure_proxy() {
  if proxy_running; then return 0; fi
  log "proxy is not running; starting it"
  dc up -d --no-deps proxy
  sleep 2
  proxy_running || { dc logs --no-color --tail 30 proxy >&2; die "proxy did not start"; }
  PROXY_STARTED=1
}

# ---------------------------------------------------------------- failure handling
POINTER_MOVED=0 PREV_ID="" PREV_TAG="" PROXY_STARTED=0 PHASE="preflight"
on_exit() {
  local rc=$?
  ((rc != 0)) || return 0
  printf '\n%s  rollout of %s stopped during: %s\n' "$(date +%H:%M:%S)" "$TAG" "$PHASE" >&2
  undrain
  if ((POINTER_MOVED)); then
    if [[ -n $PREV_ID ]]; then
      docker tag "$PREV_ID" "$POINTER" && echo "  $POINTER points back at the previous image ${PREV_TAG:-$PREV_ID}" >&2
    else
      docker rmi "$POINTER" >/dev/null 2>&1 || true
    fi
  fi
  for svc in web-a web-b worker; do
    printf '  %-7s %-10s %s\n' "$svc" "$(state_of "$svc")" "$(tags_of "$(image_of "$svc")" | head -n1)" >&2
  done
  cat >&2 <<EOF
  The proxy only routes to replicas whose /api/health answers 2xx, so the healthy replica above keeps serving.
  Inspect:   docker compose logs --tail 100 <service>
  Roll back: deploy/rollout.sh ${PREV_TAG:-<previous-tag>}      (rolling, same zero-downtime steps)
  Retry:     fix the cause, then deploy/rollout.sh --force $TAG
EOF
}
trap on_exit EXIT

# ---------------------------------------------------------------- preflight
step "preflight: $TARGET (pointer $POINTER, project ${COMPOSE_PROJECT_NAME:-chaochi})"
command -v curl >/dev/null || die "curl is required on the host"
if ((DRAIN)); then
  command -v nsenter >/dev/null && command -v nft >/dev/null && command -v ss >/dev/null ||
    die "nsenter, nft and ss are required to drain replicas (apt install util-linux nftables iproute2), or set CHAOCHI_DRAIN=0"
  ((EUID == 0)) || die "draining a replica needs root (nsenter into its network namespace), or set CHAOCHI_DRAIN=0"
fi
docker compose version >/dev/null || die "docker compose plugin is required"
[[ -r $ENV_FILE ]] || die "env file $ENV_FILE is missing or unreadable (fill it from deploy/env.template)"
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/rollout.lock"
flock -n 9 || die "another rollout holds $STATE_DIR/rollout.lock"

PHASE="image"
if ((BUILD)); then
  step "build $TARGET"
  docker build --build-arg "CHAOCHI_REVISION=$TAG" -t "$TARGET" "$ROOT"
elif [[ -n $LOAD_FILE ]]; then
  step "load $LOAD_FILE"
  docker load -i "$LOAD_FILE"
fi
if ! docker image inspect "$TARGET" >/dev/null 2>&1; then
  log "$TARGET is not local; pulling"
  docker pull "$TARGET" || die "image $TARGET not found (use --build or --load)"
fi
TARGET_ID=$(docker image inspect -f '{{.Id}}' "$TARGET")
PREV_ID=$(docker image inspect -f '{{.Id}}' "$POINTER" 2>/dev/null || true)
[[ -z $PREV_ID ]] || PREV_TAG=$(tags_of "$PREV_ID" | grep -m1 "^$REPO:" | sed "s|^$REPO:||" || true)
log "target   $TAG (${TARGET_ID:7:12})"
log "previous ${PREV_TAG:-none} ${PREV_ID:+(${PREV_ID:7:12})}"

FIRST=0
[[ -n $(cid_of web-a) || -n $(cid_of web-b) ]] || FIRST=1

if ((!FORCE && !FIRST)) && [[ $PREV_ID == "$TARGET_ID" ]]; then
  current=1
  for svc in web-a web-b worker; do [[ $(image_of "$svc") == "$TARGET_ID" ]] || current=0; done
  for svc in web-a web-b; do [[ $(state_of "$svc") == healthy ]] || current=0; done
  if ((current)); then
    ensure_proxy
    log "already running $TAG on web-a, web-b and worker; nothing to do (use --force to roll anyway)"
    exit 0
  fi
fi

# ---------------------------------------------------------------- pointer + migrations
PHASE="migrations"
docker tag "$TARGET" "$POINTER"
POINTER_MOVED=1
log "$POINTER -> $TAG"

if [[ $(state_of db) != healthy ]]; then
  step "start db"
  dc up -d --no-deps db
  wait_healthy db || die "db is not healthy"
fi
step "migrate"
dc run --rm --no-deps migrate || die "migrations failed; nothing was restarted"

# ---------------------------------------------------------------- web replicas
if ((FIRST)); then
  PHASE="first start"
  step "first start: web-a, web-b, proxy"
  dc up -d --no-deps web-a web-b
  wait_healthy web-a || die "web-a is not healthy"
  wait_healthy web-b || die "web-b is not healthy"
  ensure_proxy
  wait_routed web-a || die "the proxy does not route to web-a"
  wait_routed web-b || die "the proxy does not route to web-b"
else
  for svc in web-a web-b; do
    PHASE="rolling $svc"
    other=$(other_of "$svc")
    step "roll $svc ($other keeps serving)"
    ensure_proxy
    if [[ $(state_of "$other") != healthy && $(state_of "$svc") == healthy ]]; then
      die "$other is $(state_of "$other"); recreating $svc now would leave no healthy replica"
    fi
    t0=$SECONDS
    drain "$svc"
    dc up -d --no-deps --force-recreate "$svc"
    DRAINED_PID=""
    wait_healthy "$svc" || die "$svc is not healthy on $TAG"
    wait_routed "$svc" || die "the proxy does not route to $svc"
    log "$svc: on $TAG and serving after $((SECONDS - t0))s"
  done
fi

# ---------------------------------------------------------------- worker + proxy config
PHASE="worker"
step "worker (finishes active jobs, then restarts on $TAG)"
t0=$SECONDS
dc up -d --no-deps --force-recreate worker
sleep 3
[[ $(state_of worker) == running ]] || { dc logs --no-color --tail 30 worker >&2; die "worker is $(state_of worker)"; }
log "worker: running after $((SECONDS - t0))s"

PHASE="proxy reload"
if ((!PROXY_STARTED)); then
  step "proxy config reload (graceful; no-op when unchanged)"
  dc exec -T proxy /bin/sh /etc/chaochi/caddy/caddy.sh reload || die "proxy reload failed; the running config is unchanged"
fi

PHASE="done"
printf '%s %s %s previous=%s\n' "$(date -Is)" "$TAG" "${TARGET_ID:7:12}" "${PREV_TAG:-none}" >>"$STATE_DIR/releases.log"
step "released $TAG in $((SECONDS - STARTED))s (rollback: deploy/rollout.sh ${PREV_TAG:-<previous-tag>})"
