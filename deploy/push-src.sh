#!/usr/bin/env bash
# Update the server's source tree (/opt/chaochi/src) to one commit of this repository, in place.
# Run on the DEV machine, from the repo checkout:
#
#   deploy/push-src.sh [<rev>] [user@host]      default HEAD; host from CHAOCHI_DEPLOY_HOST or deploy/.deploy-host, key ~/.ssh/wuwa_deploy
#
# Then on the server: cd /opt/chaochi/src && deploy/rollout.sh --build "$(cat REVISION)"
#
# - Sends `git archive <rev>`: committed files only, uncommitted changes are not deployed. The short
#   revision goes to REVISION.
# - Updates the directory in place with rsync --delete. Never replace /opt/chaochi/src as a whole
#   (mv, rm -rf): the proxy container bind-mounts src/deploy at /etc/chaochi and would keep reading the
#   deleted tree, so `caddy.sh reload` fails until the proxy is recreated.
# - Needs rsync on the server (apt-get install -y rsync).
set -euo pipefail

REV=$(git rev-parse --short "${1:-HEAD}")
# The server address stays out of the repository: pass it, export CHAOCHI_DEPLOY_HOST, or keep it in
# deploy/.deploy-host (gitignored, one line: user@host).
HOST=${2:-${CHAOCHI_DEPLOY_HOST:-$(cat "$(dirname "$0")/.deploy-host" 2>/dev/null || true)}}
[[ -n $HOST ]] || { echo "push-src: no server; set CHAOCHI_DEPLOY_HOST=user@host or write it to deploy/.deploy-host" >&2; exit 64; }
KEY=${CHAOCHI_SSH_KEY:-$HOME/.ssh/wuwa_deploy}
DEST=${CHAOCHI_REMOTE_SRC:-/opt/chaochi/src}
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

[[ ${1:-HEAD} != HEAD ]] || git diff --quiet HEAD || echo "push-src: uncommitted changes are not included" >&2

git archive --format=tar "$REV" | "${SSH[@]}" "set -eu
command -v rsync >/dev/null || { echo 'push-src: rsync is missing on the server: apt-get install -y rsync' >&2; exit 1; }
stage=\$(mktemp -d '$DEST.stage.XXXXXX')
trap 'rm -rf \"\$stage\"' EXIT
tar -x -C \"\$stage\"
echo '$REV' >\"\$stage/REVISION\"
mkdir -p '$DEST'
rsync -a --delete --checksum \"\$stage/\" '$DEST/'
echo \"push-src: $HOST:$DEST is at \$(cat '$DEST/REVISION')\""
echo "push-src: next, on the server: cd $DEST && deploy/rollout.sh --build $REV"
