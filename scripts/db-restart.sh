#!/usr/bin/env bash
# Starts (or restarts) the embedded development database.
#
# The server is launched in its own process group so a restart takes the whole
# tree with it -- tsx spawns a child node process, and killing only the wrapper
# leaves the port bound.
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE=.data/db-server.pid
LOGFILE=.data/db-server.log
PORT="${RADAR_DB_PORT:-5433}"
mkdir -p .data

if [[ -f "$PIDFILE" ]]; then
  PGID="$(cat "$PIDFILE")"
  kill -TERM -- "-${PGID}" 2>/dev/null || true
  for _ in $(seq 1 40); do
    kill -0 -- "-${PGID}" 2>/dev/null || break
    sleep 0.25
  done
  kill -KILL -- "-${PGID}" 2>/dev/null || true
  rm -f "$PIDFILE"
fi

# Anything else still holding the port (e.g. a server from a previous session).
for _ in $(seq 1 20); do
  (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null || break
  exec 3<&- 3>&-
  sleep 0.25
done

setsid npx tsx scripts/db-server.ts > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

for _ in $(seq 1 60); do
  grep -q 'listening on' "$LOGFILE" 2>/dev/null && break
  grep -q 'failed to start' "$LOGFILE" 2>/dev/null && { cat "$LOGFILE"; exit 1; }
  sleep 0.5
done
cat "$LOGFILE"
