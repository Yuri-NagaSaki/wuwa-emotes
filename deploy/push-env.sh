#!/usr/bin/env bash
# Create /opt/chaochi/app-env on the server from the developer machine's .env.local.
# Run by the site owner on the DEV machine (the repo checkout that holds .env.local):
#
#   deploy/push-env.sh [user@host]          host from CHAOCHI_DEPLOY_HOST or deploy/.deploy-host, key ~/.ssh/wuwa_deploy
#
# - R2 and Cap credentials come from .env.local (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
#   CAP_API_ENDPOINT, CAP_SITE_KEY, CAP_SECRET_KEY).
# - POSTGRES_PASSWORD, AUTH_SECRET and IP_HASH_SALT are generated here with openssl.
# - The file is written over SSH with umask 077 and never printed. Only variable names are shown.
# - Refuses to overwrite an existing app-env: the database password only applies when the data
#   directory is first initialised, and a new AUTH_SECRET signs everyone out. Edit the file on the
#   server instead (see deploy/README.md「填写 app-env」).
set -euo pipefail

# The server address stays out of the repository: pass it, export CHAOCHI_DEPLOY_HOST, or keep it in
# deploy/.deploy-host (gitignored, one line: user@host).
HOST=${1:-${CHAOCHI_DEPLOY_HOST:-$(cat "$(dirname "$0")/.deploy-host" 2>/dev/null || true)}}
[[ -n $HOST ]] || { echo "push-env: no server; set CHAOCHI_DEPLOY_HOST=user@host or write it to deploy/.deploy-host" >&2; exit 64; }
KEY=${CHAOCHI_SSH_KEY:-$HOME/.ssh/wuwa_deploy}
HERE=$(cd "$(dirname "$0")" && pwd)
ENV_LOCAL=${CHAOCHI_ENV_LOCAL:-$HERE/../.env.local}
REMOTE_FILE=${CHAOCHI_REMOTE_ENV:-/opt/chaochi/app-env}
SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

[[ -r $ENV_LOCAL ]] || { echo "push-env: cannot read $ENV_LOCAL" >&2; exit 1; }
command -v openssl >/dev/null || { echo "push-env: openssl is required" >&2; exit 1; }

# Load the developer credentials in this process only.
set -a
# shellcheck disable=SC1090
. "$ENV_LOCAL"
set +a

missing=()
for v in R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY CAP_SECRET_KEY; do
  [[ -n ${!v:-} ]] || missing+=("$v")
done
if ((${#missing[@]})); then
  echo "push-env: missing in .env.local: ${missing[*]}" >&2
  exit 1
fi
case $CAP_SECRET_KEY in sk-*) ;; *) echo "push-env: CAP_SECRET_KEY does not look like a Cap secret (sk-…)" >&2; exit 1 ;; esac

# The S3 endpoint is the account host; strip a trailing bucket path such as /wuwa.
s3_endpoint=${R2_ENDPOINT%/}
s3_endpoint=${s3_endpoint%/wuwa}
case $s3_endpoint in https://*.r2.cloudflarestorage.com) ;; *) echo "push-env: unexpected R2_ENDPOINT host" >&2; exit 1 ;; esac

if "${SSH[@]}" "test -e '$REMOTE_FILE'"; then
  echo "push-env: $HOST:$REMOTE_FILE already exists; not overwriting (edit it on the server)." >&2
  exit 1
fi

pg_password=$(openssl rand -hex 24)
auth_secret=$(openssl rand -hex 32)
ip_salt=$(openssl rand -hex 16)

{
  cat <<EOF
NODE_ENV=production
SITE_NAME=潮池
SITE_SUBTITLE=鸣潮表情图鉴
SITE_URL=https://sparxie.moe

DATABASE_URL=postgres://chaochi:${pg_password}@db:5432/chaochi
POSTGRES_PASSWORD=${pg_password}
AUTH_SECRET=${auth_secret}
IP_HASH_SALT=${ip_salt}

S3_ENDPOINT=${s3_endpoint}
S3_REGION=auto
S3_BUCKET=wuwa
S3_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
S3_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
S3_FORCE_PATH_STYLE=false

CAP_API_ENDPOINT=${CAP_API_ENDPOINT:-https://cap.anibt.net/3358fb7a52/}
CAP_SITE_KEY=${CAP_SITE_KEY:-3358fb7a52}
CAP_SECRET_KEY=${CAP_SECRET_KEY}

SMTP_URL=
MAIL_FROM=

CF_ZONE_ID=
CF_PURGE_TOKEN=

LOG_LEVEL=info
EOF
} | "${SSH[@]}" "umask 077; install -d -m 700 '$(dirname "$REMOTE_FILE")' && cat > '$REMOTE_FILE' && chmod 600 '$REMOTE_FILE'"

echo "push-env: wrote $HOST:$REMOTE_FILE (mode 600) with:"
"${SSH[@]}" "sed -n 's/^\\([A-Z_][A-Z0-9_]*\\)=.*/  \\1/p' '$REMOTE_FILE'"
echo "push-env: SMTP_URL, MAIL_FROM, CF_ZONE_ID and CF_PURGE_TOKEN are empty; fill them on the server when available."
