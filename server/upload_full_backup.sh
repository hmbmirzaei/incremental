#!/bin/bash
set -e

# -----------------------------
# Load environment variables
# -----------------------------
# Export all variables from .env.sh
set -a
source .env.sh
set +a

# -----------------------------
# Log function (JSON format like winston)
# -----------------------------
log_json() {
    # $1 = level (INFO, DEBUG, ERROR)
    # $2 = message
    # $3 = chunk index (optional)
    # $4 = file name (optional)
    local level="$1"
    local message="$2"
    local chunk="$3"
    local file="$4"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # Construct JSON log entry
    local log_entry
    log_entry=$(jq -n \
        --arg ts "$timestamp" \
        --arg lvl "$level" \
        --arg msg "$message" \
        --argjson chunkIndex "${chunk:-null}" \
        --arg fileName "${file:-null}" \
        '{timestamp: $ts, level: $lvl, message: $msg, chunkIndex: $chunkIndex, fileName: $fileName}')

    # Output to console and append to log file
    echo "$log_entry"
    echo "$log_entry" >> "$UPLOAD_FULL_FILE"
}

# -----------------------------
# Temporary folder for chunks
# -----------------------------
TMP_FOLDER="/tmp/backup_chunks"
mkdir -p "$TMP_FOLDER"

# -----------------------------
# Compute SHA256 checksum of a file
# -----------------------------
compute_checksum() {
    # Compute SHA256 hash of given file
    sha256sum "$1" | awk '{print $1}'
}

# -----------------------------
# Send a file in chunks
# -----------------------------
send_file() {
    local FILE_PATH="$1"
    local RELATIVE_PATH="$2"

    # Normalize path separators
    RELATIVE_PATH="${RELATIVE_PATH//\\//}"

    # Get total size and number of chunks
    local TOTAL_SIZE
    TOTAL_SIZE=$(stat -c %s "$FILE_PATH")
    local TOTAL_CHUNKS=$(( (TOTAL_SIZE + CHUNK_SIZE - 1) / CHUNK_SIZE ))

    log_json "INFO" "Starting upload of $RELATIVE_PATH" "" "$RELATIVE_PATH"

    for ((i=0; i<TOTAL_CHUNKS; i++)); do
        OFFSET=$((i * CHUNK_SIZE))
        CHUNK_FILE="$TMP_FOLDER/chunk_${RANDOM}_${i}"

        # Extract chunk (works for small and large files)
        dd if="$FILE_PATH" of="$CHUNK_FILE" bs=1M skip=$((OFFSET / 1048576)) \
           count=$(( (CHUNK_SIZE + 1048575) / 1048576 )) status=none

        # Compute chunk checksum
        CHECKSUM=$(compute_checksum "$CHUNK_FILE")
        log_json "DEBUG" "Chunk $i checksum calculated: $CHECKSUM" "$i" "$RELATIVE_PATH"

        # Retry mechanism for sending chunk
        for ((attempt=1; attempt<=MAX_RETRIES; attempt++)); do
            log_json "INFO" "Sending chunk $i, attempt $attempt" "$i" "$RELATIVE_PATH"

            HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL" \
                -F "file=@$CHUNK_FILE;filename=${RELATIVE_PATH}.part${i}" \
                -F "chunkIndex=$i" \
                -F "totalChunks=$TOTAL_CHUNKS" \
                -F "fileName=$RELATIVE_PATH" \
                -F "checksum=$CHECKSUM" \
                -H "apikey: $API_KEY" \
                -H "algorithm: sha256")

            if [ "$HTTP_STATUS" -eq 200 ]; then
                log_json "INFO" "Chunk $i sent successfully" "$i" "$RELATIVE_PATH"
                break
            else
                log_json "ERROR" "Chunk $i failed with HTTP $HTTP_STATUS" "$i" "$RELATIVE_PATH"
                sleep 2
            fi

            if [ $attempt -eq $MAX_RETRIES ]; then
                log_json "ERROR" "Failed to send chunk $i after $MAX_RETRIES attempts" "$i" "$RELATIVE_PATH"
                exit 1
            fi
        done

        # Remove temporary chunk
        rm -f "$CHUNK_FILE"
    done

    log_json "INFO" "Finished upload of $RELATIVE_PATH" "" "$RELATIVE_PATH"
}

# -----------------------------
# Traverse folder recursively and send files
# -----------------------------
find "$Full_DUMP" -type f | while read -r FILE; do
    RELATIVE_PATH="${FILE#$Full_DUMP/}"
    send_file "$FILE" "$RELATIVE_PATH"
done

# Cleanup temporary folder
rm -rf "$TMP_FOLDER"
log_json "INFO" "All files and chunks sent successfully"
