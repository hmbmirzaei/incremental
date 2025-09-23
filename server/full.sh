#!/bin/bash

# reading parameters from .envset -a
set -a
source .env.sh
set +a

# recreate backup folder
rm -rf "$Full_DUMP"
mkdir -p "$Full_DUMP"

# dumping mongodb files
echo "🚀 starting backup into $Full_DUMP ..."
mongodump --host "$MONGO_HOST" --port "$MONGO_PORT" --out="$Full_DUMP" --oplog >> "$LOG_FILE" 2>&1

echo "✅ backup done, log file: $LOG_FILE"

# finding last ts from oplog.bson
last_ts=$(bsondump "$Full_DUMP/oplog.bson" | jq -s '.[-1].ts')
value=$(echo "$last_ts" | jq -c '."$timestamp"')

if [ -n "$value" ]; then
  echo "$value" > "$LAST_OPLOG"
  echo "[$(date)] saved last oplog ts to $LAST_OPLOG" >> "$LOG_FILE"
else
  echo "[$(date)] ERROR: could not extract ts from oplog.bson" >> "$LOG_FILE"
  exit 1
fi
