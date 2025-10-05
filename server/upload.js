
import { exec } from 'child_process';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { statSync, createReadStream, readFileSync, unlinkSync, readdirSync, renameSync } from 'fs';
import FormData from 'form-data';

import logger from './logger.js';
import { api, compressed_dir, zip_size, hash_algorithm, unsynced, synced } from './config.js';

/**
 * Request a password for encrypting the zip file from the backup server
 * @param {string} file_name - The base name of the file (without .zip)
 * @returns {Promise<string>} - The password string for encryption
 */
const get_password = async file_name => {
    try {
        const { data } = await api.post(
            '/password/generate',
            { filename: `${file_name}.zip` },
            { headers: { type: 'mongodb' } },
        );
        logger.info(`[Password] Generated for ${file_name}`);
        return data;
    } catch (error) {
        logger.error(`[Password] Failed to get password for ${file_name}: ${error.message}`);
        throw new Error('Error in get password');
    }
};


/**
 * Compress a file using 7z with AES256 encryption and the provided password
 * @param {string} file_name - The name of the file to compress (e.g. 'myfile.txt')
 * @param {string} file_dir - The directory containing the file
 * @param {string} password - The password to use for encryption
 * @returns {Promise<string>} - The name of the created zip file (e.g. 'myfile.txt.zip')
 */
const compress = async (file_name, file_dir, password) => {
    try {
        const output_path = path.join(compressed_dir, `${file_name}.zip`);
        if (!existsSync(compressed_dir)) mkdirSync(compressed_dir, { recursive: true });

        const base_file = path.basename(file_name);
        const command = `cd "${file_dir}" && 7z a -tzip -mem=AES256 -p"${password}" "${path.resolve(output_path)}" "${base_file}"`;

        logger.info(`[Compress] Running: ${command}`);

        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`[Compress] Error: ${stderr || error.message}`);
                    return reject(new Error(`Compression error: ${stderr || error.message}`));
                }
                logger.info(`[Compress] Created ${file_name}.zip`);
                resolve(`${file_name}.zip`);
            });
        });
    } catch (error) {
        logger.error(`[Compress] Unexpected error for ${file_name}: ${error.message}`);
        throw new Error('Error in compress');
    }
};


/**
 * Calculate the checksum of a file synchronously (for small files)
 * @param {string} file_path - The path to the file
 * @param {string} algorithm - The hash algorithm (e.g. 'sha256')
 * @returns {string} - The checksum as a hex string
 */
const calculate_checksum_sync = (file_path, algorithm) => {
    try {
        const hash = createHash(algorithm);
        const file_buffer = readFileSync(file_path);
        hash.update(file_buffer);
        const digest = hash.digest('hex');
        logger.info(`[Checksum] Calculated sync: ${digest}`);
        return digest;
    } catch (error) {
        logger.error(`[Checksum] Sync error: ${error.message}`);
        throw new Error('Error in calculate_checksum_sync');
    }
};

/**
 * Calculate the checksum of a file using a stream (for large files)
 * @param {string} file_path - The path to the file
 * @param {string} algorithm - The hash algorithm (e.g. 'sha256')
 * @returns {Promise<string>} - The checksum as a hex string
 */
const calculate_checksum_stream = (file_path, algorithm) => new Promise((resolve, reject) => {
    try {
        const hash = createHash(algorithm);
        const stream = createReadStream(file_path);

        stream.on('error', err => {
            logger.error(`[Checksum] Stream error: ${err.message}`);
            reject(err);
        });
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => {
            const digest = hash.digest('hex');
            logger.info(`[Checksum] Calculated stream: ${digest}`);
            resolve(digest);
        });
    } catch (err) {
        logger.error(`[Checksum] Unexpected stream error: ${err.message}`);
        reject(err);
    }
});

/**
 * Determine whether to calculate checksum synchronously or via stream based on file size
 * @param {string} filename - The name of the compressed file (e.g. 'myfile.txt.zip')
 * @param {string} algorithm - The hash algorithm (e.g. 'sha256')
 * @returns {Promise<string>} - The checksum as a hex string
 */
const checksum = async (filename, algorithm) => {
    const compressed_file_path = path.join(compressed_dir, filename);
    try {
        const { size } = statSync(compressed_file_path);
        const size_mb = size / (1024 * 1024);

        logger.info(`[Checksum] ${compressed_file_path} - Size: ${size_mb.toFixed(2)} MB`);

        return size_mb <= zip_size
            ? calculate_checksum_sync(compressed_file_path, algorithm)
            : calculate_checksum_stream(compressed_file_path, algorithm);

    } catch (error) {
        logger.error(`[Checksum] Failed: ${error.message}`);
        throw new Error(error.message || 'Error in checksum');
    }
};

/**
 * Upload the compressed zip file and its checksum to the backup server
 * Deletes the zip file after successful upload
 * @param {string} zip_file - The name of the zip file (e.g. 'myfile.txt.zip')
 * @param {string} file_checksum - The checksum string
 * @returns {Promise<void>}
 */
const upload_incremental = async (zip_file, file_checksum) => {
    try {
        const file_path = path.join(compressed_dir, zip_file);
        const form = new FormData();

        form.append('file', createReadStream(file_path));
        form.append('checksum', file_checksum);
        form.append('filename', zip_file);
        form.append('algorithm', hash_algorithm);

        logger.info(`[Upload] Sending ${zip_file} with checksum ${file_checksum}`);

        const { data } = await api.post('/upload', form, {
            headers: { ...form.getHeaders() },
            maxBodyLength: Infinity,
        });

        logger.info(`[Upload] Success: ${data}`);
        unlinkSync(file_path);
        logger.info(`[Cleanup] Removed ${file_path}`);
    } catch (error) {
        logger.error(`[Upload] Failed for ${zip_file}: ${error.message}`);
        throw new Error(`Error in upload: ${error.message}`);
    }
};

//process a file
const process_file = async (file_name, unsynced, hash_algorithm) => {
    try {
        logger.info(`[Main] Processing file: ${file_name}`);

        const password = await get_password(file_name);
        const zipFile = await compress(file_name, unsynced, password);
        const calcChecksum = await checksum(zipFile, hash_algorithm);
        await upload_incremental(zipFile, calcChecksum);

        renameSync(path.join(unsynced, file_name), path.join(synced, file_name));
        logger.info(`[Main] Moved ${file_name} to synced`);
    } catch (error) {
        logger.error(`[Main] Error with ${file_name}: ${error.message}`);
        // اگه بخوای متوقف شه:
        // throw error;
    }
}


// sync backup
//    1. (path) --< get list of files >--> (filename)
//    2. (filename) --> get password --> password
//    3. (file_obj, password) --> compress --> zipfile
//    4. (zipfile, checksum) --> upload to backup server --> ()
//    5. (zipfile) --> remove file after upload --> ()

// Main uploader function:
// 1. Reads unsynced files
// 2. For each file: gets password, compresses, checksums, uploads, and deletes original
/**
 * Main uploader function
 * Reads unsynced files, compresses, checksums, uploads, and deletes originals
 */
// infinite uploader loop
(async () => {
    while (true) {
        try {
            let files_list = readdirSync(unsynced)
                .sort((a, b) => statSync(path.join(unsynced, a)).mtimeMs - statSync(path.join(unsynced, b)).mtimeMs);

            if (!files_list || files_list.length === 0) 
                throw new Error('No unsynced files found. Waiting 10 minutes...')


            const file_name = files_list[0]; // اولین فایل (قدیمی‌ترین)
            await process_file(file_name, unsynced, hash_algorithm);

        } catch (error) {
            logger.error(`[Main] Fatal error: ${error.message}`);
            // در صورت خطا هم ۱۰ دقیقه صبر کنه
            await new Promise(res => setTimeout(res, 10 * 60 * 1000));
        }
    }
})();