import path from 'path';
import { retrieve } from './password.js';
import { uncompress } from './uncompress.js';
import { unlinkSync } from 'fs';
import File from './model.js';

(async () => {
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
            console.log(`File ${name} removed (not a zip)`);
            return;
        }
        filename = name;
        const password = await retrieve(base, 'mongodb');
        file.password_retrieved = new Date();
        await file.save();

        await uncompress(base, password);
        file.decompressed = new Date();
        await file.save();

        console.log("Done:", base, "at", new Date().toISOString());
    } catch (error) {
        console.error(`Error processing file ${filename}: ${error.message}`);
    }
    finally {
        process.exit(0);
    }
})();