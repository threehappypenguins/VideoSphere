/**
 * VideoSphere — Appwrite setup script
 *
 * Creates the database and tables (like a migration). Run after .env.local is
 * configured and the connection test passes: pnpm run setup:appwrite
 *
 * Loads .env.local from the project root. Uses tsx so we run TypeScript directly.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client, TablesDB } from 'node-appwrite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
config({ path: resolve(root, '.env.local') });

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
const apiKey = process.env.APPWRITE_API_KEY;

const DATABASE_ID = 'videosphere';
const DB_NAME = 'VideoSphere';

function log(msg: string): void {
  console.log('[setup-appwrite]', msg);
}

interface TableColumn {
  key: string;
  type: string;
  size?: number;
  required: boolean;
}

interface TableConfig {
  tableId: string;
  name: string;
  columns: TableColumn[];
}

const tables: TableConfig[] = [
  {
    tableId: 'drafts',
    name: 'Drafts',
    columns: [
      { key: 'userId', type: 'string', size: 255, required: true },
      { key: 'title', type: 'string', size: 500, required: true },
      { key: 'description', type: 'string', size: 5000, required: true },
      /* tags: stored as JSON string; repository must JSON.stringify/parse to match Draft.tags (string[]). */
      { key: 'tags', type: 'string', size: 2000, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  {
    tableId: 'upload_jobs',
    name: 'Upload Jobs',
    columns: [
      { key: 'userId', type: 'string', size: 255, required: true },
      { key: 'draftId', type: 'string', size: 255, required: false },
      { key: 'status', type: 'string', size: 64, required: true },
      { key: 'errorMessage', type: 'string', size: 2000, required: false },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  {
    tableId: 'user_profiles',
    name: 'User Profiles',
    columns: [
      { key: 'userId', type: 'string', size: 255, required: true },
      { key: 'email', type: 'string', size: 255, required: true },
      { key: 'isSupporter', type: 'boolean', required: true },
      { key: 'role', type: 'string', size: 32, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
  },
];

async function main(): Promise<void> {
  if (!endpoint || !projectId || !apiKey) {
    log(
      'Missing env: set NEXT_PUBLIC_APPWRITE_ENDPOINT, NEXT_PUBLIC_APPWRITE_PROJECT_ID, APPWRITE_API_KEY in .env.local'
    );
    process.exit(1);
  }

  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const db = new TablesDB(client);

  try {
    const list = await db.list({ total: true });
    const exists = list.databases?.some((d) => d.$id === DATABASE_ID) ?? false;
    if (!exists) {
      await db.create({ databaseId: DATABASE_ID, name: DB_NAME });
      log(`Created database: ${DB_NAME} (${DATABASE_ID})`);
    } else {
      log(`Database already exists: ${DATABASE_ID}`);
    }
  } catch (e) {
    const err = e as { message?: string };
    log('Failed to create database: ' + (err?.message ?? String(e)));
    process.exit(1);
  }

  for (const t of tables) {
    try {
      await db.getTable({ databaseId: DATABASE_ID, tableId: t.tableId });
      log(`Table already exists: ${t.tableId}`);
    } catch (e) {
      const err = e as { code?: number; message?: string };
      const isNotFound = err?.code === 404;
      if (!isNotFound) {
        log('Failed to get table ' + t.tableId + ': ' + (err?.message ?? String(e)));
        process.exit(1);
      }
      try {
        await db.createTable({
          databaseId: DATABASE_ID,
          tableId: t.tableId,
          name: t.name,
          columns: t.columns,
        });
        log(`Created table: ${t.name} (${t.tableId})`);
      } catch (createErr) {
        const createErrObj = createErr as { message?: string };
        log(
          'Failed to create table ' +
            t.tableId +
            ': ' +
            (createErrObj?.message ?? String(createErr))
        );
        process.exit(1);
      }
    }
  }

  log('Setup complete.');
}

main().catch((e) => {
  const err = e as { message?: string };
  log('Unhandled error in setup-appwrite: ' + (err?.message ?? String(e)));
  process.exit(1);
});
