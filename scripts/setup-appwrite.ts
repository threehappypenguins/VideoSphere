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
import { Client, IndexType, TablesDB } from 'node-appwrite';

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
  {
    tableId: 'connected_accounts',
    name: 'Connected Accounts',
    columns: [
      { key: 'userId', type: 'string', size: 255, required: true },
      { key: 'platform', type: 'string', size: 64, required: true },
      { key: 'accessToken', type: 'string', size: 4096, required: true },
      { key: 'refreshToken', type: 'string', size: 4096, required: true },
      { key: 'tokenExpiry', type: 'string', size: 64, required: true },
      { key: 'platformUserId', type: 'string', size: 255, required: true },
      { key: 'platformName', type: 'string', size: 500, required: true },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
  },
  {
    tableId: 'upload_usage',
    name: 'Upload Usage',
    columns: [
      { key: 'userId', type: 'string', size: 255, required: true },
      { key: 'month', type: 'string', size: 7, required: true },
      { key: 'uploadCount', type: 'integer', required: true },
    ],
  },
  {
    tableId: 'platform_uploads',
    name: 'Platform Uploads',
    columns: [
      { key: 'uploadJobId', type: 'string', size: 255, required: true },
      { key: 'platform', type: 'string', size: 64, required: true },
      { key: 'status', type: 'string', size: 64, required: true },
      { key: 'platformVideoId', type: 'string', size: 255, required: false },
      { key: 'platformUrl', type: 'string', size: 2048, required: false },
      { key: 'title', type: 'string', size: 500, required: true },
      { key: 'description', type: 'string', size: 5000, required: true },
      { key: 'tags', type: 'string', size: 2000, required: true },
      { key: 'visibility', type: 'string', size: 64, required: true },
      { key: 'scheduledAt', type: 'datetime', required: false },
      { key: 'errorMessage', type: 'string', size: 2000, required: false },
      { key: 'createdAt', type: 'datetime', required: true },
      { key: 'updatedAt', type: 'datetime', required: true },
    ],
  },
];

/** Indexes to create per table so queries by userId/status work and user_profiles.userId is unique. */
const tableIndexes: {
  tableId: string;
  indexes: { key: string; type: IndexType; columns: string[] }[];
}[] = [
  {
    tableId: 'drafts',
    indexes: [{ key: 'drafts_userId', type: IndexType.Key, columns: ['userId'] }],
  },
  {
    tableId: 'upload_jobs',
    indexes: [
      { key: 'upload_jobs_userId', type: IndexType.Key, columns: ['userId'] },
      { key: 'upload_jobs_userId_status', type: IndexType.Key, columns: ['userId', 'status'] },
    ],
  },
  {
    tableId: 'user_profiles',
    indexes: [
      { key: 'user_profiles_userId_unique', type: IndexType.Unique, columns: ['userId'] },
      { key: 'user_profiles_email', type: IndexType.Key, columns: ['email'] },
    ],
  },
  {
    tableId: 'connected_accounts',
    indexes: [
      { key: 'connected_accounts_userId', type: IndexType.Key, columns: ['userId'] },
      // One connection per user per platform (PRD: "their YouTube account", "their Vimeo account").
      // Stretch goal: multiple accounts per platform — drop this unique index, optionally add a
      // label/connectionName column, and add API to list/select which connection to use per upload.
      {
        key: 'ca_userId_platform_unique',
        type: IndexType.Unique,
        columns: ['userId', 'platform'],
      },
    ],
  },
  {
    tableId: 'upload_usage',
    indexes: [
      { key: 'upload_usage_userId', type: IndexType.Key, columns: ['userId'] },
      {
        key: 'upload_usage_userId_month_unique',
        type: IndexType.Unique,
        columns: ['userId', 'month'],
      },
    ],
  },
  {
    tableId: 'platform_uploads',
    indexes: [
      { key: 'platform_uploads_uploadJobId', type: IndexType.Key, columns: ['uploadJobId'] },
      {
        // One platform_uploads record per upload job per target platform
        key: 'pu_uploadJobId_platform_unique',
        type: IndexType.Unique,
        columns: ['uploadJobId', 'platform'],
      },
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

  const tablesCreatedThisRun = new Set<string>();

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
        });
        log(`Created table: ${t.name} (${t.tableId})`);
        tablesCreatedThisRun.add(t.tableId);
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
      for (const col of t.columns) {
        try {
          if (col.type === 'string') {
            await db.createStringColumn({
              databaseId: DATABASE_ID,
              tableId: t.tableId,
              key: col.key,
              size: col.size ?? 255,
              required: col.required,
            });
          } else if (col.type === 'datetime') {
            await db.createDatetimeColumn({
              databaseId: DATABASE_ID,
              tableId: t.tableId,
              key: col.key,
              required: col.required,
            });
          } else if (col.type === 'boolean') {
            await db.createBooleanColumn({
              databaseId: DATABASE_ID,
              tableId: t.tableId,
              key: col.key,
              required: col.required,
            });
          } else if (col.type === 'integer') {
            await db.createIntegerColumn({
              databaseId: DATABASE_ID,
              tableId: t.tableId,
              key: col.key,
              required: col.required,
            });
          } else {
            log('Skipping unknown column type: ' + col.type + ' (key: ' + col.key + ')');
          }
        } catch (colErr) {
          const colErrObj = colErr as { code?: number; message?: string };
          if (colErrObj?.code === 409) {
            log(`Column already exists: ${t.tableId}.${col.key}`);
          } else {
            log(
              'Failed to create column ' +
                t.tableId +
                '.' +
                col.key +
                ': ' +
                (colErrObj?.message ?? String(colErr))
            );
            process.exit(1);
          }
        }
      }
    }
  }

  // Columns can take a moment to become available for indexing.
  if (tablesCreatedThisRun.size > 0) {
    const indexDelayMs = 5_000;
    log(`Waiting ${indexDelayMs / 1000}s for columns to be ready before creating indexes...`);
    await new Promise((r) => setTimeout(r, indexDelayMs));
  }

  for (const { tableId, indexes } of tableIndexes) {
    for (const idx of indexes) {
      try {
        await db.createIndex({
          databaseId: DATABASE_ID,
          tableId,
          key: idx.key,
          type: idx.type,
          columns: idx.columns,
        });
        log(`Created index: ${tableId}.${idx.key}`);
      } catch (e) {
        const err = e as { code?: number; message?: string };
        if (err?.code === 409) {
          log(`Index already exists: ${tableId}.${idx.key}`);
        } else {
          log(
            'Failed to create index ' + tableId + '.' + idx.key + ': ' + (err?.message ?? String(e))
          );
          process.exit(1);
        }
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
