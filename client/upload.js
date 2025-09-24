import path from 'path';
import multer, { diskStorage } from 'multer';
import { unlinkSync, existsSync, mkdirSync, statSync, createReadStream, createWriteStream } from 'fs';
import logger from './logger.js';
import calc from './checksum.js';
import { compressed_dir as upload_folder, full_folder } from './config.js';
import File from './model.js';

const regex = /^incremental-backup-(\d{4}-\d{2}-\d{2}--\d{1,2}-\d{2}-\d{2})-(\d+)-(\d+)-/;

// Ensure upload folders exists
if (!existsSync(upload_folder))
    mkdirSync(upload_folder);

if (!existsSync(full_folder))
    mkdirSync(full_folder, { recursive: true });

// multer storage configuration for full uploads
const storage_full = multer.diskStorage({
    destination: (req, file, cb) => cb(null, full_folder),
    filename: (req, file, cb) => cb(null, file.originalname)
});

export const upload_full_option = multer({ storage: storage_full });

/**
 * Multer configuration for storing uploaded chunks
 */
export const upload_option = multer({
    storage: diskStorage({
        destination: (req, res, cb) => {
            cb(null, upload_folder);
        },
        filename: (req, file, cb) => {
            cb(null, file.originalname); // Use original file name
        }
    })
});

/**
 * Handle uploaded file: verify checksum and respond
 * @param {Request} req
 * @param {Response} res
 */
export const uploaded_incremental = async (req, res) => {
    let filepath;
    try {
        const { checksum, algorithm } = req.body;
        filepath = req.file.path;  // Actual path of uploaded file by multer
        const file = path.parse(filepath);
        const filename = file.base;

        const match = filename.match(regex);
        if (!match)
            throw new Error('file name is not in expected style');

        const pre_saved_file = await File.findOne({
            filename
        });

        if (!pre_saved_file)
            throw new Error('file not found in db');

        const calced = await calc(filepath, algorithm || 'sha256');
        if (calced !== checksum) {
            File.wrong_checksum = calced;
            await File.save();
            throw new Error(`Checksum error: Uploaded file is corrupted or tampered.`);
        };

        const stats = statSync(filepath);
        pre_saved_file.size = stats.size;
        pre_saved_file.checksum = calced;
        pre_saved_file.checksum_algorithm = algorithm;
        pre_saved_file.date_time = match[1];
        pre_saved_file.t = match[2];
        pre_saved_file.i = match[3];
        pre_saved_file.received_time = new Date().toISOString();
        await pre_saved_file.save();

        console.log(`✅ Checksum OK for file: ${filepath}`);
        res.json('File received successfully.');
    } catch (error) {
        console.log(error);
        try { if (filepath && existsSync(filepath)) unlinkSync(filepath); } catch (e) { }
        return res.status(400).send(`❌ ` + (error.message || 'Error occurred during upload.'));
    }
};


/**
 * Append a chunk file to the final target file
 * @param {string} source_path - path to chunk
 * @param {string} target_path - path to final file
 * @returns {Promise<void>}
 */
export const append_chunk = (source_path, target_path, hash = null) => new Promise((resolve, reject) => {
    const rs = createReadStream(source_path);
    const ws = createWriteStream(target_path, { flags: 'a' });

    // Handle errors
    rs.on('error', reject);
    ws.on('error', reject);

    // Resolve when write finished
    ws.on('finish', resolve);

    // Pipe chunk to final file
    rs.pipe(ws);
});

/**
 * Handle uploaded chunk
 * - Verify chunk checksum
 * - Append to final file
 * - Remove temporary chunk
 * - Log all steps
 */
export const uploaded_full = async (req, res) => {
    const { chunkIndex, fileName, checksum, totalChunks } = req.body;
    const { algorithm } = req.headers;

    const uploaded_path = req.file?.path;
    if (!uploaded_path || !existsSync(uploaded_path)) {
        logger.error(`Chunk ${chunkIndex} not saved`, { chunkIndex, fileName });
        return res.status(400).send(`❌ chunk ${chunkIndex} not saved.`);
    }

    // Build final file path and create directories
    const final_file_path = path.join(full_folder, fileName);
    mkdirSync(path.dirname(final_file_path), { recursive: true });

    try {
        // Verify checksum of uploaded chunk using checksum.js
        const calced = await calc(uploaded_path, algorithm || 'sha256');

        if (calced !== checksum) {
            // Remove corrupted chunk
            unlinkSync(uploaded_path);
            logger.error(`Checksum failed`, { chunkIndex, fileName });
            return res.status(400).send(`❌ Checksum chunk ${chunkIndex} failed.`);
        }

        logger.info(`Checksum ok`, { chunkIndex, fileName });

        // Append chunk to final file
        await append_chunk(uploaded_path, final_file_path); // pass null because we don't need crypto hash

        // Remove temporary chunk
        unlinkSync(uploaded_path);
        logger.info(`Chunk appended`, { chunkIndex, fileName });

        // If last chunk, calculate final checksum with checksum.js
        if (parseInt(chunkIndex) + 1 === parseInt(totalChunks)) {
            const final_checksum = await calc(final_file_path, algorithm || 'sha256');
            logger.info(`Final file checksum: ${final_checksum}`, { fileName });
        }

        res.send(`✅ chunk ${chunkIndex} added to ${fileName}`);
    } catch (err) {
        logger.error(`Error in chunk ${chunkIndex}`, { fileName, error: err.message });
        res.status(500).send(`❌ error in chunk ${chunkIndex}: ${err.message}`);
    }
};
