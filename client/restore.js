import { createReadStream, renameSync } from 'fs';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import readline from 'readline';

import { mongodb_port, mongodb_host, restore_received_files, incremental_dir, restored_folder } from './config.js';
import File from './model.js';

const uri = `mongodb://${mongodb_host}:${mongodb_port}`;

/**
 * Convert MongoDB diff object to update operators
 * @param {object} diff
 * @returns {object} MongoDB update object
 */
const convert_diff_to_update = diff => {
    const update = {};
    if (diff.u) {
        update.$set = {};
        for (const key in diff.u)
            update.$set[key] = diff.u[key];
    };

    if (diff.d) {
        update.$unset = {};
        for (const key in diff.d)
            update.$unset[key] = "";
    };

    return update;
};

/**
 * Restore a single oplog line to MongoDB
 * @param {MongoClient} client
 * @param {string} line - JSONL line
 * @returns {Promise<boolean>} - true if success, false if error
 */
const restore_single_line = async (client, line) => {
    try {
        const oplogEntry = EJSON.parse(line);
        const [dbName, collName] = oplogEntry.ns.split('.');
        if (!dbName || !collName) return false;

        const db = client.db(dbName);
        const coll = db.collection(collName);

        if (oplogEntry.op === 'i') {
            try {
                await coll.insertOne(oplogEntry.o);
            } catch (err) {
                if (err.code === 11000) {
                    await coll.replaceOne({ _id: oplogEntry.o._id }, oplogEntry.o, { upsert: true });
                } else {
                    throw err;
                }
            }
        } else if (oplogEntry.op === 'u') {
            const filter = oplogEntry.o2;

            if (oplogEntry.o.$v === 2 && oplogEntry.o.diff) {
                const update = convert_diff_to_update(oplogEntry.o.diff);
                await coll.updateOne(filter, update);
            } else {
                throw new Error('Unsupported update format');
            }
        } else if (oplogEntry.op === 'd') {
            await coll.deleteOne(oplogEntry.o);
        }

        return true;
    } catch (err) {
        console.log(err)
        console.error(`❌ Error restoring line: ${err.message}`);
        return false;
    }
};

const sleep = s => new Promise(resolve => setTimeout(resolve, s * 1000));

/**
 * Restore a JSONL file (each line is a complete JSON object).
 * @param {string} file - The file name to restore (relative to incremental/)
 * @returns {Promise<{ success: number, fail: number }>}
 */
(async () => {
    if (!restore_received_files)
        process.exit(0);
    while (true) {
        let file_name;
        try {
            const unrestored_file = await File.findOne({
                restored: null
            }).sort({ createdAt: 1 });
            if (!unrestored_file)
                throw new Error('no unrestored file found');

            file_name = unrestored_file.filename.slice(0, -4);
            const client = new MongoClient(uri);
            await client.connect();
            const filePath = `${incremental_dir}/${file_name}`;
            let success = 0, fail = 0;

            const rl = readline.createInterface({
                input: createReadStream(filePath),
                crlfDelay: Infinity
            });

            for await (const line of rl) {
                if (!line.trim()) continue; // Skip empty lines

                const completed_line = await restore_single_line(client, line);
                if (completed_line)
                    success++;
                else
                    fail++;
            };
            unrestored_file.restored = true;
            await unrestored_file.save();
            renameSync(`${incremental_dir}/${file_name}`, `${restored_folder}/${file_name}`)
        } catch (err) {
            if (err.message == 'no unrestored file found')
                await sleep(1 * 60)
            else
                console.error(`❌ Error reading or processing file ${file_name}: ${err.message}`);
        }
    }
})()