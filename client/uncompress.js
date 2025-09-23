import { exec } from 'child_process';
import path from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';

import { compressed_dir as source_dir, incremental_dir as dest_dir } from './config.js';
import logger from './logger.js';

/**
 * Extract a password-protected ZIP file using 7z and return the extracted file name
 * @param {string} filename - ZIP file name (e.g. example.zip)
 * @param {string} password - Password for the ZIP file
 * @returns {Promise<string>} - Extracted file name (without path)
 */
export const uncompress = async (filename, password) => {
    const zip_path = path.join(source_dir, filename);

    if (!existsSync(zip_path))
        throw new Error(`File ${zip_path} does not exist.`);

    if (!existsSync(dest_dir))
        mkdirSync(dest_dir, { recursive: true });

    const command = `7z x -p"${password}" -o"${dest_dir}" "${zip_path}" -y`;

    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                const isWrongPassword = stderr.includes('Wrong password') || stdout.includes('Wrong password');
                const errMsg = isWrongPassword ? '❌ Incorrect password.' : `Error extracting file:\n${stderr || error.message}`;
                logger.error('Uncompress error', { file: filename, error: errMsg });
                return reject(new Error(errMsg));
            }

            // Find the extracted file name from the output
            const match = stdout.match(/Extracting\s+(.+)\s*/);
            if (match && match[1]) {
                const extracted_file_name = path.basename(match[1].trim());
                unlinkSync(zip_path);
                logger.info('Uncompressed file', { file: filename, extracted: extracted_file_name });
                return resolve(extracted_file_name.slice(0, -4) + '.jsonl');
            } else {
                logger.error('Extracted file name not found', { file: filename });
                return reject(new Error('Extracted file name not found.'));
            }
        });
    });
};
