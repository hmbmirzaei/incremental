#!/bin/bash
# ---------------------------------------------------
# Resend specific chunks of a large file safely
# Logs in JSON format using log_json()
# Usage: ./upload_full_failed_chunks.sh workflow/files.bson 1745 1850
# ---------------------------------------------------
set -e

# ---------------------------
# Load environment variables
# ---------------------------
set -a
source .env.sh
set +a

# ---------------------------
# JSON log function
# ---------------------------
source ./logger.sh
# ---------------------------
# Check input arguments
# ---------------------------
if [ "$#" -lt 2 ]; then
    log_json "ERROR" "Usage: $0 <relative_file_path> <chunk1> [chunk2 ...]"
    exit 1
fi

FILE_NAME="$1"
shift
CHUNK_INDICES=("$@")

FILE_PATH="$Full_DUMP/$FILE_NAME"
RELATIVE_PATH="$FILE_NAME"

# ---------------------------
# Validate file exists
# ---------------------------
if [ ! -f "$FILE_PATH" ]; then
    log_json "ERROR" "File not found: $FILE_PATH"
    exit 1
fi

mkdir -p "$TMP_FOLDER"

compute_checksum() {
    sha256sum "$1" | awk '{print $1}'
}

resend_chunk() {
    local FILE_PATH="$1"
    local RELATIVE_PATH="$2"
    local INDEX="$3"

    local OFFSET=$((INDEX * CHUNK_SIZE))
    local CHUNK_FILE="$TMP_FOLDER/chunk_${RANDOM}_${INDEX}"

    log_json "INFO" "Extracting chunk $INDEX" "$INDEX" "$RELATIVE_PATH"

    dd if="$FILE_PATH" of="$CHUNK_FILE" bs=1M skip=$((OFFSET / 1048576)) \
       count=$(( (CHUNK_SIZE + 1048575) / 1048576 )) status=none

    local CHECKSUM
    CHECKSUM=$(compute_checksum "$CHUNK_FILE")
    log_json "DEBUG" "Chunk $INDEX checksum: $CHECKSUM" "$INDEX" "$RELATIVE_PATH"

    for (( attempt=1; attempt<=MAX_RETRIES; attempt++ )); do
        log_json "INFO" "Sending chunk $INDEX, attempt $attempt" "$INDEX" "$RELATIVE_PATH"

        # Save both HTTP code and response body
        RESPONSE=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL" \
            -F "file=@$CHUNK_FILE;filename=${RELATIVE_PATH}.part${INDEX}" \
            -F "chunk_index=$INDEX" \
            -F "file_name=$RELATIVE_PATH" \
            -F "checksum=$CHECKSUM" \
            -H "apikey: $API_KEY" \
            -H "algorithm: sha256" \
        )

        # Separate HTTP code (last 3 digits) from response body
        HTTP_STATUS="${RESPONSE: -3}"
        RESPONSE_BODY="${RESPONSE:0:-3}"

        if [ "$HTTP_STATUS" -eq 200 ]; then
            log_json "INFO" "Chunk $INDEX sent successfully" "$INDEX" "$RELATIVE_PATH"
            break
        else
            log_json "ERROR" "Chunk $INDEX failed with HTTP $HTTP_STATUS. Response body: $RESPONSE_BODY" "$INDEX" "$RELATIVE_PATH"
            sleep 2
        fi

        if [ $attempt -eq $MAX_RETRIES ]; then
            log_json "ERROR" "Failed to send chunk $INDEX after $MAX_RETRIES attempts" "$INDEX" "$RELATIVE_PATH"
            exit 1
        fi
    done


    # Remove temporary chunk
    rm -f "$CHUNK_FILE"
    log_json "DEBUG" "Temporary chunk $INDEX removed" "$INDEX" "$RELATIVE_PATH"
}

# ---------------------------
# Loop over specified chunk indices
# ---------------------------
for INDEX in "${CHUNK_INDICES[@]}"; do
    resend_chunk "$FILE_PATH" "$RELATIVE_PATH" "$INDEX"
done

log_json "INFO" "All specified chunks resent successfully" "" "$RELATIVE_PATH"
