#!/bin/bash
# Installed on the server as /usr/local/sbin/realdeal-deploy (root-owned). The `deploy` user's
# SSH key can run only this script (forced command + sudoers). It reads a release tarball on
# stdin, installs it as a new release, switches over and rolls back if the health check fails.
# Changing this file in the repo does not change the server copy; reinstall it by hand.
set -euo pipefail
ROOT=/opt/realdeal
NEW=$ROOT/releases/$(date -u +%Y%m%d-%H%M%S)
TMP=$(mktemp)
SWITCHED=0
trap 'rm -f "$TMP"; [ $SWITCHED = 1 ] || rm -rf "$NEW"' EXIT

head -c 50000000 > "$TMP"
install -d -o realdeal -g realdeal "$NEW"
sudo -u realdeal tar -xzf - -C "$NEW" --no-same-owner < "$TMP"
echo "Unpacked $(cat "$NEW/REVISION" 2>/dev/null || echo unknown) into $NEW"
sudo -u realdeal env HOME=$ROOT PATH=/opt/node/bin:/usr/bin:/bin \
	bash -c "cd '$NEW' && npm ci --omit=dev --no-audit --no-fund --loglevel=error"

PREV=$(readlink -f $ROOT/current || true)
switch() { ln -sfn "$1" $ROOT/current.tmp && mv -T $ROOT/current.tmp $ROOT/current && systemctl restart realdeal; }
healthy() { for _ in $(seq 30); do curl -fs -o /dev/null http://127.0.0.1:8787/api/health && return 0; sleep 1; done; return 1; }

switch "$NEW"
SWITCHED=1
if ! healthy; then
	echo "New release failed its health check; rolling back to $PREV" >&2
	[ -n "$PREV" ] && switch "$PREV"
	exit 1
fi
echo "Live: $NEW"
# Keep the three newest releases.
ls -1dt $ROOT/releases/* | tail -n +4 | xargs -r rm -rf
