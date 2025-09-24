
import { exec } from 'child_process';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { statSync, createReadStream, readFileSync, unlinkSync, readdirSync, renameSync } from 'fs';
import FormData from 'form-data';

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
        return data;
    } catch (error) {
        console.log(`${error}`);
        throw new Error('error in get password')
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

        if (!existsSync(compressed_dir))
            mkdirSync(compressed_dir, { recursive: true });

        // Extract the base file name (e.g. 'myfile.txt' from 'myfile.txt')
        const base_file = path.basename(file_name);

        // Command: go to the file directory and compress only the base file
        const command = `cd "${file_dir}" && 7z a -tzip -mem=AES256 -p"${password}" "${path.resolve(output_path)}" "${base_file}"`;

        return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(`Compression error:\n${stderr || error.message}`));
                }
                resolve(`${file_name}.zip`);
            });
        });
    } catch (error) {
        throw new Error('error in compress')
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
        return hash.digest('hex');
    } catch (error) {
        throw new Error('error in calculate_checksum_sync')
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

        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    } catch (err) {
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

        console.log(`[Checksum] ${compressed_file_path} - Size: ${size_mb.toFixed(2)} MB`);
        return size_mb <= zip_size
            ?
            calculate_checksum_sync(compressed_file_path, algorithm)
            :
            calculate_checksum_stream(compressed_file_path, algorithm)

    } catch (error) {
        console.log(error)
        throw new Error(error.message || 'error')
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

        const { data } = await api.post('/upload', form, {
            headers: {
                ...form.getHeaders(),
            },
            maxBodyLength: Infinity, // To avoid size limitation
        });

        console.log('✅ Server response:', data);
        unlinkSync(file_path)
    } catch (error) {
        throw new Error('❌ Error in upload:', error.message);
    }
};

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
 * @returns {Promise<void>}
 */
const upload = async () => {
    try {
        const files_list = await readdirSync(unsynced);
        if (!files_list || files_list.length === 0) {
            console.log('No unsynced files found.');
            return;
        }
        for (const file_name of files_list) {
            try {
                // Get password for this file
                const password = await get_password(file_name);
                // Compress the file (file_name is the file, unsynced is the directory)
                const zip_file = await compress(file_name, unsynced, password);
                // Calculate checksum of the zip file
                const calc_checksum = await checksum(zip_file, hash_algorithm);
                // Upload the zip file and its checksum
                await upload_incremental(zip_file, calc_checksum);
                // Remove the original file after successful upload
                renameSync(path.join(unsynced, file_name), path.join(synced, file_name));
            } catch (error) {
                console.log(error.message);
            }
        }
    } catch (error) {
        console.log(error.message);
    }
}
upload().catch(console.log)
export default upload;
