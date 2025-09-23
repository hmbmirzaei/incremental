import dotenv from 'dotenv';
dotenv.config();
const {
    APIKEY,
    CHECKSUM_SIZE_THRESHOLD_MB,
    APP_PORT,
    MONGODB_DB,
    MONGODB_PORT,
    MONGODB_HOST,
    UPLOAD_FOLDER,
    COMPRESSED_DIR,
    INCREMENTAL_DIR,
    RESTORE,
    RESTORED_FOLDER,
    LOG_FOLDER,
    FULL_FOLDER
} = process.env;


export const apikey = APIKEY;
export const checksum_size_thresholdMB = Number(CHECKSUM_SIZE_THRESHOLD_MB) || 20;
export const app_port = APP_PORT || 54322;
export const mongodb_db = MONGODB_DB || 'backup';
export const mongodb_port = MONGODB_PORT || 27017;
export const mongodb_host = MONGODB_HOST || 'localhost';
export const upload_folder = UPLOAD_FOLDER || './compressed';
export const compressed_dir = COMPRESSED_DIR || './compressed';
export const incremental_dir = INCREMENTAL_DIR || './incremental';
export const restore_received_files = RESTORE === 'true' || RESTORE === true;
export const restored_folder = RESTORED_FOLDER || './restored';
export const log_folder = LOG_FOLDER || './logs';
export const full_folder = FULL_FOLDER || './full';