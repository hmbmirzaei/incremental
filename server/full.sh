#!/bin/bash

# enable exporting variables from .env.sh

set -a
source .env.sh
set +a

# logger function

log() {
	local level="$1"
	local message="$2"
	local ts
	ts=$(date +"%Y-%m-%d %H:%M:%S")
	echo "{"level":"$level","message":"$message","timestamp":"$ts"}" | tee -a "$LOG_FILE"
}

# recreate backup folder

rm -rf "$Full_DUMP"
mkdir -p "$Full_DUMP"

# start backup

log "info" "Starting full backup into $Full_DUMP"
mongodump --host "$MONGO_HOST" --port "$MONGO_PORT" --out="$Full_DUMP" --oplog >> "$LOG_FILE" 2>&1

if [ $? -ne 0 ]; then
	log "error" "mongodump failed, check $LOG_FILE"
	exit 1
fi

log "info" "Backup finished successfully"

# extract last ts from oplog.bson

last_ts=$(bsondump "$Full_DUMP/oplog.bson" | jq -c '."ts"."$timestamp"' | tail -n 1)

if [ -n "$last_ts" ] && [ "$last_ts" != "null" ]; then
	echo "$last_ts" > "$LAST_OPLOG"
	log "info" "Saved last oplog ts to $LAST_OPLOG"
else
	log "error" "Could not extract ts from oplog.bson"
	exit 1
fi
