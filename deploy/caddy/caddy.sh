#!/bin/sh
# Entry point of the proxy container (compose.yaml mounts deploy/ at /etc/chaochi).
#   caddy.sh run        start Caddy (the container command)
#   caddy.sh reload     graceful config reload, no dropped connections:
#                       docker compose exec proxy /bin/sh /etc/chaochi/caddy/caddy.sh reload
#   caddy.sh validate   check the config without serving
#   caddy.sh adapt      print the resulting JSON config
#
# TLS (CHAOCHI_TLS_MODE):
#   auto      (default) Cloudflare Origin CA pair when /certs/origin.pem and /certs/origin-key.pem
#             both exist, otherwise Caddy's internal CA
#   origin    require the Origin CA pair (Cloudflare SSL mode "Full (strict)")
#   internal  Caddy's internal CA (Cloudflare SSL mode "Full"; "Full (strict)" rejects it)
# After adding or replacing the certificate files, run `reload`.
set -eu

CONF=/etc/chaochi/caddy/Caddyfile
RANGES=/etc/chaochi/cloudflare-ips.txt
CERT=/certs/origin.pem
KEY=/certs/origin-key.pem

mode=${CHAOCHI_TLS_MODE:-auto}
if [ "$mode" = auto ]; then
	if [ -s "$CERT" ] && [ -s "$KEY" ]; then mode=origin; else mode=internal; fi
fi
case $mode in
	origin)
		if [ ! -s "$CERT" ] || [ ! -s "$KEY" ]; then
			echo "caddy.sh: CHAOCHI_TLS_MODE=origin but $CERT or $KEY is missing" >&2
			exit 66
		fi
		;;
	internal) ;;
	*)
		echo "caddy.sh: CHAOCHI_TLS_MODE must be auto, origin or internal (got '$mode')" >&2
		exit 64
		;;
esac

CHAOCHI_CF_RANGES=$(grep -Ev '^[[:space:]]*(#|$)' "$RANGES" | tr '\n' ' ')
if [ -z "$CHAOCHI_CF_RANGES" ]; then
	echo "caddy.sh: no ranges in $RANGES" >&2
	exit 66
fi
: "${CHAOCHI_UPSTREAMS:?CHAOCHI_UPSTREAMS is set by compose.yaml}"

export CHAOCHI_TLS="$mode" CHAOCHI_CF_RANGES
export CHAOCHI_DOMAIN="${CHAOCHI_DOMAIN:-sparxie.moe}"
export CHAOCHI_HTTPS_PORT="${CHAOCHI_HTTPS_PORT:-443}"
# empty = all interfaces (production); e.g. CHAOCHI_BIND=127.0.0.1 for a local test stack
export CHAOCHI_DEFAULT_BIND="${CHAOCHI_BIND:+default_bind $CHAOCHI_BIND}"
mkdir -p /run/caddy

cmd=${1:-run}
echo "caddy.sh: $cmd tls=$mode domain=$CHAOCHI_DOMAIN port=$CHAOCHI_HTTPS_PORT bind=${CHAOCHI_BIND:-all} upstreams=$CHAOCHI_UPSTREAMS" >&2
case $cmd in
	run) exec caddy run --config "$CONF" --adapter caddyfile ;;
	reload) exec caddy reload --config "$CONF" --adapter caddyfile --address unix//run/caddy/admin.sock ;;
	validate) exec caddy validate --config "$CONF" --adapter caddyfile ;;
	adapt) exec caddy adapt --config "$CONF" --adapter caddyfile --pretty ;;
	*)
		echo "usage: caddy.sh run|reload|validate|adapt" >&2
		exit 64
		;;
esac
