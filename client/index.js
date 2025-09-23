
import express from 'express';
import { app_port } from './config.js';
import { auth } from './auth.js';
import { upload_option, uploaded_full, upload_full_option, uploaded_incremental } from './upload.js';
import { action } from './password.js';

const app = express();
app.use(auth);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('static'));

app.post('/password/:act', action);
app.post('/upload', upload_option.single('file'), uploaded_incremental);

// Full upload route (chunks assembling). auth middleware is applied globally
app.post('/upload_full', upload_full_option.single('file'), uploaded_full);
app.listen(app_port, () => {
    console.log(`running upload server on port ${app_port}`);
});

