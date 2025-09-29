#!/bin/bash
set -e

# -----------------------------
# Load environment variables
# -----------------------------
set -a
source .env.sh
set +a

# -----------------------------
# Log function (JSON format like winston)
# -----------------------------
source ./logger.sh

# -----------------------------
# Resume tracking file
# -----------------------------
RESUME_FILE=./upload_resume.json

save_resume() {
    local file="$1"
    local chunk="$2"
    jq -n --arg file "$file" --argjson chunk "$chunk" \
       '{fileName: $file, chunkIndex: $chunk}' > "$RESUME_FILE"
}

load_resume() {
    if [ -f "$RESUME_FILE" ]; then
        RESUME_FILE_NAME=$(jq -r '.fileName' "$RESUME_FILE")
        RESUME_CHUNK=$(jq -r '.chunkIndex' "$RESUME_FILE")
    else
        RESUME_FILE_NAME=""
        RESUME_CHUNK=0
    fi
}

clear_resume() {
    rm -f "$RESUME_FILE"
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
    sha256sum "$1" | awk '{print $1}'
}

# -----------------------------
# Send a file in chunks with resume support
# -----------------------------
send_file() {
    local FILE_PATH="$1"
    local RELATIVE_PATH="$2"

    RELATIVE_PATH="${RELATIVE_PATH//\\//}"
    local TOTAL_SIZE
    TOTAL_SIZE=$(stat -c %s "$FILE_PATH")
    local TOTAL_CHUNKS=$(( (TOTAL_SIZE + CHUNK_SIZE - 1) / CHUNK_SIZE ))

    log_json "INFO" "Starting upload of $RELATIVE_PATH" "" "$RELATIVE_PATH"

    # بررسی resume
    local START_CHUNK=0
    if [ "$RELATIVE_PATH" == "$RESUME_FILE_NAME" ]; then
        START_CHUNK=$RESUME_CHUNK
        log_json "INFO" "Resuming $RELATIVE_PATH from chunk $START_CHUNK" "$START_CHUNK" "$RELATIVE_PATH"
    fi

    for ((i=START_CHUNK; i<TOTAL_CHUNKS; i++)); do
        OFFSET=$((i * CHUNK_SIZE))
        CHUNK_FILE="$TMP_FOLDER/chunk_${RANDOM}_${i}"

        dd if="$FILE_PATH" of="$CHUNK_FILE" bs=1M skip=$((OFFSET / 1048576)) \
           count=$(( (CHUNK_SIZE + 1048575) / 1048576 )) status=none

        CHECKSUM=$(compute_checksum "$CHUNK_FILE")
        log_json "DEBUG" "Chunk $i checksum calculated: $CHECKSUM" "$i" "$RELATIVE_PATH"

        for ((attempt=1; attempt<=MAX_RETRIES; attempt++)); do
            log_json "INFO" "Sending chunk $i, attempt $attempt" "$i" "$RELATIVE_PATH"

            HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SERVER_URL" \
                -F "file=@$CHUNK_FILE;filename=${RELATIVE_PATH}.part${i}" \
                -F "chunk_index=$i" \
                -F "total_chunks=$TOTAL_CHUNKS" \
                -F "file_name=$RELATIVE_PATH" \
                -F "checksum=$CHECKSUM" \
                -H "apikey: $API_KEY" \
                -H "algorithm: sha256")

            if [ "$HTTP_STATUS" -eq 200 ]; then
                log_json "INFO" "Chunk $i sent successfully" "$i" "$RELATIVE_PATH"

                # ✅ ذخیره پیشرفت بعد از هر chunk موفق
                save_resume "$RELATIVE_PATH" $((i+1))

                break
            else
                log_json "ERROR" "Chunk $i failed with HTTP $HTTP_STATUS" "$i" "$RELATIVE_PATH"
                sleep 2
            fi

            if [ $attempt -eq $MAX_RETRIES ]; then
                log_json "ERROR" "Failed to send chunk $i after $MAX_RETRIES attempts" "$i" "$RELATIVE_PATH"
                save_resume "$RELATIVE_PATH" "$i"
                exit 1
            fi
        done
        rm -f "$CHUNK_FILE"
    done

    log_json "INFO" "Finished upload of $RELATIVE_PATH" "" "$RELATIVE_PATH"

    # وقتی فایل کامل شد، resume پاک شه
    clear_resume
}


# -----------------------------
# Main execution
# -----------------------------
load_resume
find "$Full_DUMP" -type f | while read -r FILE; do
    RELATIVE_PATH="${FILE#$Full_DUMP/}"

    # اگر resume مربوط به فایل دیگه باشه، از اون رد بشه
    if [ -n "$RESUME_FILE_NAME" ] && [ "$RELATIVE_PATH" != "$RESUME_FILE_NAME" ] && [ "$RESUME_CHUNK" -ne 0 ]; then
        continue
    fi

    log_json "DEBUG" "Preparing to send file: $RELATIVE_PATH" "" "$FILE"
    send_file "$FILE" "$RELATIVE_PATH"
done

rm -rf "$TMP_FOLDER"
log_json "INFO" "All files and chunks sent successfully"
