import mongoose from 'mongoose';
import { mongodb_db, mongodb_port, mongodb_host, compressed_dir } from './config.js';

const mongodb = {
    atlas: `mongodb://${mongodb_host}:${mongodb_port}/${mongodb_db}`,
    host: mongodb_host,
    port: mongodb_port,
    collection: mongodb_db,
};

// Connect to MongoDB
mongoose.connect(mongodb.atlas).then(() => {
    console.log('MongoDB connected');
}).catch((err) => {
    console.error('MongoDB connection error:', err);
});

const mongooseSchema = mongoose.Schema;

export const schema_model = {
    filename: {
        type: String,
        default: "",
    },
    size: {
        type: Number,
        default: 0,
    },
    contentType: {
        type: String,
        default: "",
    },
    password: {
        type: String,
        default: "",
    },
    file_type: {
        type: String,
        default: null,
    },
    checksum: {
        type: String,
        default: null,
    },
    checksum_algorithm: {
        type: String,
        default: null,
    },
    date_time: {
        type: String,
        default: null,
    },
    t: {
        type: Number,
        default: null
    },
    i: {
        type: Number,
        default: null
    },
    wrong_checksum: {
        type: String,
        default: null
    },
    received_time: {
        type: Date,
        default: null
    },
    password_retrieved: {
        type: Date,
        default: null
    },
    decompressed: {
        type: Date,
        default: null
    },
    restored: {
        type: Boolean,
        default: null
    }
};

export const schema = new mongooseSchema(schema_model, { timestamps: true });

export default mongoose.model('File', schema);
