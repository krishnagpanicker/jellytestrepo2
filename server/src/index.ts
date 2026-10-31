import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
    });
});

app.listen(PORT, () => {
    console.log(`Server running on PORT ${PORT}`);
})