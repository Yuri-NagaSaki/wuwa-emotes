#!/usr/bin/env bash
# Release one pushed commit to production. Run on the DEV machine, from a checkout of this repository:
#
#   deploy/release.sh [<rev>] [user@host] [--no-wait] [--probe]
#
#   <rev>       a commit on origin/develop or origin/main (default origin/develop, after git fetch)
#   user@host   the server (default CHAOCHI_DEPLOY_HOST, then deploy/.deploy-host); key ~/.ssh/wuwa_deploy
#   --no-wait   do not wait for CI; rollout.sh pulls the image and stops before changing anything if it is missing
#   --probe     request <site>/api/health every 0.5 s while rollout.sh runs; print ok/failed counts at the end
#
# 1. Waits until CI has published ghcr.io/yuri-nagasaki/wuwa-emotes:<sha7> (gh run list for the commit,
#    or docker manifest inspect), at most CHAOCHI_RELEASE_TIMEOUT seconds (default 1800). Stops early
#    when CI failed or was cancelled, or when no CI run exists: only the last commit of a push gets one.
# 2. Runs on the server over SSH, streaming rollout.sh's timestamped lines:
#      cd /opt/chaochi/src && git fetch --quiet origin && git checkout --quiet --detach <sha> && deploy/rollout.sh <sha7>
#
# Exit status: rollout.sh's (0 released, 1 stopped before going live, 2 live but the proxy kept its
# previous config), 255 when ssh fails, 1 or 64 when release.sh stops before reaching the server.
#
# /opt/chaochi/src must be a git clone of https://github.com/Yuri-NagaSaki/wuwa-emotes.git, updated in
# place as above. Never replace the directory (mv, rm -rf, a fresh clone): the proxy container
# bind-mounts src/deploy at /etc/chaochi and would keep reading the deleted tree (deploy/README.md「发布」).
#
# Settings: CHAOCHI_SITE_URL (default https://sparxie.moe), CHAOCHI_RELEASE_TIMEOUT, CHAOCHI_SSH_KEY,
# CHAOCHI_REMOTE_SRC (default /opt/chaochi/src), CHAOCHI_IMAGE_REPO (default ghcr.io/yuri-nagasaki/wuwa-emotes).
set -euo pipefail

usage() { sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 64; }

WAIT=1 PROBE=0 REV="" HOST_ARG=""
while (($#)); do
  case $1 in
    --no-wait) WAIT=0 ;;
    --probe) PROBE=1 ;;
    -h | --help) usage ;;
    -*) echo "release: unknown option: $1" >&2; usage ;;
    *)
      if [[ -z $REV ]]; then REV=$1
      elif [[ -z $HOST_ARG ]]; then HOST_ARG=$1
      else usage
      fi ;;
  esac
  shift
done

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$HERE/.."

GH_REPO=Yuri-NagaSaki/wuwa-emotes
IMAGE=${CHAOCHI_IMAGE_REPO:-ghcr.io/yuri-nagasaki/wuwa-emotes}
SITE=${CHAOCHI_SITE_URL:-https://sparxie.moe}
KEY=${CHAOCHI_SSH_KEY:-$HOME/.ssh/wuwa_deploy}
DEST=${CHAOCHI_REMOTE_SRC:-/opt/chaochi/src}
TIMEOUT=${CHAOCHI_RELEASE_TIMEOUT:-1800}
NO_RUN_GRACE=120 # GitHub lists a push run within seconds; none after this long means there is none

log() { printf '%s  release: %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '%s  release: %s\n' "$(date +%H:%M:%S)" "$1" >&2; exit "${2:-1}"; }

# ---------------------------------------------------------------- commit
git fetch --quiet origin || die "git fetch origin failed"
REV=${REV:-origin/develop}
SHA=$(git rev-parse --verify --quiet "$REV^{commit}") || die "unknown revision: $REV" 64
[[ $SHA =~ ^[0-9a-f]{40}$ ]] || die "unexpected commit id for $REV: $SHA"
TAG=${SHA:0:7} # the CI image tag: always the first 7 characters, never git's --short length
ON=""
for branch in develop main; do
  if git merge-base --is-ancestor "$SHA" "origin/$branch" 2>/dev/null; then ON+=" origin/$branch"; fi
done
[[ -n $ON ]] || die "$TAG is not on origin/develop or origin/main; push it first (CI publishes images only for those branches)"
log "commit $TAG (on$ON): $(git log -1 --format=%s "$SHA")"

# ---------------------------------------------------------------- server
# The server address stays out of the repository and out of this output: pass it, export
# CHAOCHI_DEPLOY_HOST, or keep it in deploy/.deploy-host (gitignored, one line: user@host).
if [[ -n $HOST_ARG ]]; then
  HOST=$HOST_ARG HOST_FROM="the command line"
elif [[ -n ${CHAOCHI_DEPLOY_HOST:-} ]]; then
  HOST=$CHAOCHI_DEPLOY_HOST HOST_FROM=CHAOCHI_DEPLOY_HOST
else
  HOST=$(cat "$HERE/.deploy-host" 2>/dev/null || true) HOST_FROM=deploy/.deploy-host
fi
HOST=${HOST//[[:space:]]/}
[[ -n $HOST ]] || die "no server; set CHAOCHI_DEPLOY_HOST=user@host or write it to deploy/.deploy-host" 64
[[ $HOST != -* ]] || die "invalid server from $HOST_FROM" 64
log "server from $HOST_FROM"

# ---------------------------------------------------------------- image
published() { command -v docker >/dev/null && docker manifest inspect "$IMAGE:$TAG" >/dev/null 2>&1; }

# State of the commit's push runs of the `ci` workflow: success | pending | failed <run url> | none.
# Filtered by name, not --workflow ci.yml: that lookup fails until the file is on the default branch.
ci_state() {
  gh run list --repo "$GH_REPO" --commit "$SHA" --event push --limit 50 \
    --json workflowName,status,conclusion,url --jq '
      [.[] | select(.workflowName == "ci")] |
      if any(.[]; .conclusion == "success") then "success"
      elif any(.[]; .status != "completed") then "pending"
      elif length > 0 then "failed \(.[0].url)"
      else "none" end'
}

wait_for_image() {
  local deadline=$((SECONDS + TIMEOUT)) started=$SECONDS use_gh=0 gh_errors=0 out st="" last=""
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then use_gh=1; fi
  ((use_gh)) || command -v docker >/dev/null ||
    die "cannot see CI: install gh and run gh auth login (or docker, for a public package), or pass --no-wait"
  log "waiting for $IMAGE:$TAG (at most ${TIMEOUT}s)"
  while :; do
    if published; then log "$IMAGE:$TAG is published"; return 0; fi
    if ((use_gh)); then
      if out=$(ci_state 2>&1); then
        gh_errors=0 st=$out
        case $out in
          success) log "CI passed for $TAG, so $IMAGE:$TAG is published"; return 0 ;;
          failed*) die "CI did not pass for $TAG, so there is no image: ${out#failed }" ;;
          none)
            ((SECONDS - started < NO_RUN_GRACE)) ||
              die "no CI run for a push of $TAG; only the last commit of a push gets an image: release that commit, or push again" ;;
        esac
      else
        ((++gh_errors < 3)) || die "gh run list keeps failing: $out"
        st="gh run list failed, retrying"
      fi
      [[ $st == "$last" ]] || log "CI: $st"
      last=$st
    fi
    ((SECONDS < deadline)) || die "no $IMAGE:$TAG after ${TIMEOUT}s (CHAOCHI_RELEASE_TIMEOUT); check the CI run for $TAG"
    sleep 10
  done
}

if ((WAIT)); then
  wait_for_image
else
  log "not waiting for CI: rollout.sh pulls $IMAGE:$TAG and stops before changing anything if it is missing"
fi

# ---------------------------------------------------------------- probe
PROBE_PID="" PROBE_LOG=""
probe_start() {
  local url=${SITE%/}/api/health
  PROBE_LOG=$(mktemp "${TMPDIR:-/tmp}/chaochi-probe.XXXXXX")
  log "probe: GET $url every 0.5 s"
  (
    trap 'exit 0' TERM
    while :; do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null) || true
      printf '%s %s\n' "$(date +%H:%M:%S)" "${code:-000}" >>"$PROBE_LOG"
      sleep 0.5
    done
  ) &
  PROBE_PID=$!
}
probe_stop() {
  [[ -n $PROBE_PID ]] || return 0
  kill "$PROBE_PID" 2>/dev/null || true
  wait "$PROBE_PID" 2>/dev/null || true
  PROBE_PID=""
  local ok fail
  ok=$(awk '$2 ~ /^2/' "$PROBE_LOG" | wc -l)
  fail=$(awk '$2 !~ /^2/' "$PROBE_LOG" | wc -l)
  log "probe: $((ok)) ok, $((fail)) failed"
  ((fail == 0)) || awk '$2 !~ /^2/ { print "  " $1 "  HTTP " $2 }' "$PROBE_LOG" | head -n 20
  rm -f "$PROBE_LOG"
}

# ---------------------------------------------------------------- rollout on the server
printf -v REMOTE 'cd %q && git fetch --quiet origin && git checkout --quiet --detach %s && deploy/rollout.sh %s' \
  "$DEST" "$SHA" "$TAG"
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

log "on the server: $REMOTE"
if ((PROBE)); then
  probe_start
  trap probe_stop EXIT
fi
rc=0
"${SSH[@]}" "$REMOTE" || rc=$?
probe_stop
trap - EXIT

case $rc in
  0) log "released $TAG" ;;
  255) log "ssh failed (exit 255): the server was not reached, or the connection dropped. On the server, check \
docker compose ps and /opt/chaochi/state/releases.log before retrying" ;;
  *) log "rollout.sh exited with $rc" ;;
esac
exit "$rc"
