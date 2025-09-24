import File from './model.js';
import { encrypt, decrypt } from './crypto.js';
import { v4 } from 'uuid';

export const generate = async (filename, type) => {
    try {
        const password = v4();
        const encrypted = encrypt(password);
        await File.create({ filename, password: encrypted, file_type: type });
        return password;
    } catch (error) {
        console.log(`${error}`)
        throw new Error(error.message)
    }
};

export const retrieve = async (filename, file_type) => {
    try {
        const file = await File.findOne({ filename, file_type });
        if (!file)
            throw new Error('file not found');
        const password = decrypt(file.password)
        file.password_retrieved = new Date();
        await file.save();
        return password;
    } catch (error) {
        console.log(`${error}`)
        throw new Error(error.message);
    }
};
const funcs = { generate, retrieve };

export const action = async (req, res) => {
    const { act } = req.params;
    const { filename } = req.body
    const { type } = req.headers;
    try {
        if (!['generate', 'retrieve'].includes(act))
            throw new Error('invalid action');

        const result = await funcs[act](filename, type);
        res.json(result);
    } catch (error) {
        console.log(error);
        res.status(400).send(`❌ ` + error.message || `Error occurred during password processing`);
    }
};
