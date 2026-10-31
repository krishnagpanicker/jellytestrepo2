import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error('Database URL is missing.');
}

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/db/schema.ts',
    out: './drizzle',
    dbCredentials: {
        url: process.env.DATABASE_URL!
    }
})

const databaseUrl = new URL(process.env.DATABASE_URL);

console.log({
  host: databaseUrl.hostname,
  port: databaseUrl.port,
  database: databaseUrl.pathname.slice(1),
});