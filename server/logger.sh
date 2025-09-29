#!/bin/bash

# -----------------------------
# Log function (JSON format like winston)
# -----------------------------
log_json() {
    local level="$1"
    local message="$2"
    local chunk="$3"
    local file="$4"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    local log_entry
    log_entry=$(jq -n \
        --arg ts "$timestamp" \
        --arg lvl "$level" \
        --arg msg "$message" \
        --argjson chunkIndex "${chunk:-null}" \
        --arg fileName "${file:-null}" \
        '{timestamp: $ts, level: $lvl, message: $msg, chunkIndex: $chunkIndex, fileName: $fileName}')

    echo "$log_entry"
    echo "$log_entry" >> "$UPLOAD_FULL_FILE"
}
