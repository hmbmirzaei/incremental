import { createHash } from 'crypto';
import { statSync, createReadStream, readFileSync } from 'fs';
import { checksum_size_thresholdMB } from './config.js';

/**
 * Calculate checksum synchronously (for small files)
 * @param {string} filePath - Path to the file
 * @param {string} algorithm - Hash algorithm (e.g. 'sha256')
 * @returns {string} - Checksum as hex string
 */
const calc1 = (filePath, algorithm) => {
    const hash = createHash(algorithm);
    const fileBuffer = readFileSync(filePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
};

/**
 * Calculate checksum using a stream (for large files)
 * @param {string} filePath - Path to the file
 * @param {string} algorithm - Hash algorithm (e.g. 'sha256')
 * @returns {Promise<string>} - Checksum as hex string
 */
const calc2 = (filePath, algorithm) => new Promise((resolve, reject) => {
    try {
        const hash = createHash(algorithm);
        const stream = createReadStream(filePath);

        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    } catch (err) {
        reject(err);
    }
});

/**
 * Smart checksum calculation (sync for small files, stream for large files)
 * @param {string} filePath - Path to the file
 * @param {string} algorithm - Hash algorithm (default: blake2b512)
 * @returns {Promise<string>} - Checksum as hex string
 */
export default async (filePath, algorithm) => {
    try {
        const { size } = statSync(filePath);
        const sizeMB = size / (1024 * 1024);

        console.log(`[Checksum] ${filePath} - Size: ${sizeMB.toFixed(2)} MB`);
        return sizeMB <= checksum_size_thresholdMB
            ?
            calc1(filePath, algorithm)
            :
            calc2(filePath, algorithm)

    } catch (error) {
        console.log(error)
        throw new Error(error.message || 'Error calculating checksum')
    }
};
