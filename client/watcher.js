import path from 'path';
import { retrieve } from './password.js';
import { uncompress } from './uncompress.js';
import { unlinkSync } from 'fs';
import File from './model.js';
import logger from './logger.js';
const sleep = s => new Promise(resolve => setTimeout(resolve, s * 1000));

(async () => {
    while (true) {
        let filename;
        try {
            const file = await File.findOne({
                password_retrieved: null
            }).sort({ createdAt: 1 });

            if (!file)
                throw new Error('no new file found');

            const { ext, name, base } = path.parse(file.filename);
            if (ext !== ".zip") {
                unlinkSync(file);
                logger.warn('Removed non-zip file record', { name });
                continue;
            }
            filename = name;
            const password = await retrieve(base, 'mongodb');
            file.password_retrieved = new Date();
            await file.save();

            await uncompress(base, password);
            file.decompressed = new Date();
            await file.save();

            logger.info('Decompression done', { file: base, at: new Date().toISOString() });
        } catch (error) {
            logger.error('Error processing file', { file: filename, error: error.message });
            await sleep(10);
        }
    }
})();