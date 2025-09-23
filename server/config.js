import axios from "axios";
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '.env') });
const {
    MONGO_HOST,
    MONGO_PORT,
    Full_DUMP,
    TARGET_BACKUP_SERVER,
    TARGET_BACKUP_APIKEY,
    HASH_ALGORITM,
    TEMP_FOLDER,
    COMPRESSED_FOLDER,
    ZIP_SIZE,
    LAST_OPLOG,
    INCREMENTAL,
    SYNCED,
    LOG_FOLDER
} = process.env;

export const mongo = {
    host: MONGO_HOST || 'localhost',
    port: MONGO_PORT || '27017',
    uri: `mongodb://${MONGO_HOST || 'localhost'}:${MONGO_PORT || '27017'}/local`
};

export const target_backup_api = {
    url: TARGET_BACKUP_SERVER,
    key: TARGET_BACKUP_APIKEY
};

export const api = axios.create({
    baseURL: TARGET_BACKUP_SERVER,
    headers: {
        apiKey: TARGET_BACKUP_APIKEY
    }
});

export const full_dump_location = Full_DUMP || './full';
export const hash_algorithm = HASH_ALGORITM || 'sha256';
export const compressedDir = COMPRESSED_FOLDER || './compressed';

export const zip_size = Number(ZIP_SIZE) || 104857600; // 100MB
export const lastOplog = LAST_OPLOG || './last-oplog-ts.json';
export const unsynced = INCREMENTAL || './incrementals';
export const temp_folder = TEMP_FOLDER || './temp';
export const temp_file = path.join(temp_folder, `tempfile_${Math.floor(Math.random() * 1e9)}.bson`);
export const lastTsFile = LAST_OPLOG || path.join(temp_folder, './last-oplog-ts.json');
export const compressed_dir = COMPRESSED_FOLDER || './compressed';
export const synced = SYNCED || './synced';
export const log_folder = LOG_FOLDER || './logs';
