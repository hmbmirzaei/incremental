import path from 'path';
import multer, { diskStorage } from 'multer';
import { unlinkSync, existsSync, mkdirSync, statSync, createReadStream, createWriteStream, renameSync, readdirSync } from 'fs';
import logger from './logger.js';
import calc from './checksum.js';
import { compressed_dir as upload_folder, full_folder, tmp_folder } from './config.js';
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
 * Handle uploaded chunk
 * - Verify chunk checksum
 * - Store chunk in tmp folder
 * - Log all steps
 */
export const uploaded_full = async (req, res) => {
    const { chunk_index, file_name, checksum, total_chunks } = req.body;
    const { algorithm } = req.headers;

    try {
        logger.info(`chunk recaived`, { chunk_index, total_chunks })
        const uploaded_path = req.file?.path;
        if (!uploaded_path || !existsSync(uploaded_path)) {
            logger.error(`Chunk ${chunk_index} not saved`, { chunk_index, file_name });
            throw new Error(`❌ chunk ${chunk_index} not saved.`);
        }

        const chunk_folder = path.join(tmp_folder, file_name);
        mkdirSync(chunk_folder, { recursive: true });

        // verify checksum
        const calced = await calc(uploaded_path, algorithm || "sha256");
        if (calced !== checksum) {
            logger.error(`❌ checksum mismatch on chunk ${chunk_index}`, { chunk_index, file_name });
            throw new Error(`❌ checksum mismatch on chunk ${chunk_index}`);
        }

        // move chunk to tmp folder
        const chunk_file_path = path.join(chunk_folder, String(chunk_index).padStart(6, "0"));
        renameSync(uploaded_path, chunk_file_path);

        logger.info(`Chunk ${chunk_index} stored`, { file_name });
        res.json(`✅ chunk ${chunk_index} stored for ${file_name}`);
    } catch (err) {
        console.log(err)
        logger.error(`Error handling chunk ${chunk_index}`, { file_name, error: err.message });
        res.status(500).send(`❌ error in chunk ${chunk_index}: ${err.message}`);
    }
};

/**
 * Assemble all chunks for a given file
 * - Append chunks in order
 * - Delete each chunk after append
 * - Compute final checksum
 */
export const assemble_file = async (req, res) => {
    const { file_name, total_chunks } = req.body;
    try {
        const chunk_folder = path.join(tmp_folder, file_name);
        const final_file_path = path.join(full_folder, file_name);

        if (!existsSync(chunk_folder)) {
            logger.error(`❌ no chunks found for ${file_name}`);
            throw new Error(`❌ no chunks found for ${file_name}`);
        }

        mkdirSync(path.dirname(final_file_path), { recursive: true });
        const ws = createWriteStream(final_file_path);

        for (let i = 0; i < total_chunks; i++) {
            const chunk_path = path.join(chunk_folder, String(i).padStart(6, "0"));
            if (!existsSync(chunk_path)) {
                logger.error(`❌ missing chunk ${i}`, { file_name });
                throw new Error(`❌ missing chunk ${i}`);
            }

            await new Promise((resolve, reject) => {
                const rs = createReadStream(chunk_path);
                rs.pipe(ws, { end: false });
                rs.on("end", resolve);
                rs.on("error", reject);
            });

            unlinkSync(chunk_path); // remove chunk after append
            logger.info(`Chunk ${i} appended and removed`, { file_name });
        }

        ws.end();

        const final_checksum = await calc(final_file_path, "sha256");
        logger.info(`Final checksum: ${final_checksum}`, { file_name });

        res.send(`✅ file ${file_name} assembled with checksum ${final_checksum}`);
    } catch (err) {
        logger.error(`Error assembling file ${file_name}`, { error: err.message });
        res.status(500).send(`❌ error assembling ${file_name}: ${err.message}`);
    }
};
