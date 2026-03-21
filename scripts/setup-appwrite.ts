/**
 * VideoSphere — Appwrite setup script
 *
 * Creates the database and tables (like a migration). Run after .env.local is
 * configured and the connection test passes: pnpm run setup:appwrite
 *
 * Loads .env.local from the project root. Uses tsx so we run TypeScript directly.
 *
 * If setup fails partway on the `drafts` table, delete the table in the Console
 * and run this script again.
 *
 * **Logical schema** follows Appwrite docs (`varchar` / `text` / `mediumtext`),
 * but some self-hosted builds **ignore `columns` on `createTable`** (table exists,
 * `listColumns` stays empty). This script therefore:
 *   1. Creates **empty** tables with `createTable({ databaseId, tableId, name })`.
 *   2. Adds columns with **`createStringColumn`** (…/columns/string) — the route
 *      that works on instances where `varchar` / `text` column routes 404.
 *
 * `text` / `mediumtext` in the config map to **string columns with an explicit
 * `size`** (≤ 16,383). Keep sizes as small as practical: Appwrite counts large
 * string columns toward a **~64KB per-row** budget (inline storage). Two
 * 12,000-char token columns plus other fields can exceed that and Appwrite returns
 * “maximum number or size of columns” when adding the second token column.
 *
 * Drafts: **`userId`** (for indexes / list queries) + **`document`** — one JSON
 * string `{ targets, title, description, visibility, tags, platforms }`
 * (document-style, max length 16,383 for the string column API). Drop and
 * recreate `drafts` if the schema changed.
 *
 * Platform uploads: **`document`** only for copy metadata — JSON
 * `{ title, description, tags, visibility }` (same 16,383 cap). No separate
 * title/description/tags/visibility columns. Drop and recreate `platform_uploads`
 * when changing this shape.
 *
 * Timestamps: use Appwrite system `$createdAt` / `$updatedAt` only. If an older
 * project had custom `createdAt`/`updatedAt` columns, remove them in the Console
 * to free column slots (this script does not delete columns).
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

const APPWRITE_STRING_MAX = 16_383;

/** Column keys already on the table (from listColumns). Updated as we create. */
async function fetchColumnKeys(
  db: TablesDB,
  databaseId: string,
  tableId: string
): Promise<Set<string>> {
  const { columns } = await db.listColumns({
    databaseId,
    tableId,
    total: false,
  });
  const keys = (columns ?? []).map((c) => {
    const row = c as Record<string, unknown>;
    if (typeof row.key === 'string' && row.key !== '') return row.key;
    return '';
  });
  return new Set(keys.filter(Boolean));
}

/**
 * Size for `createStringColumn` (deprecated “string” attribute; max 16,383).
 * Logical `text` / `mediumtext` use explicit `size` on the column config.
 */
function stringColumnSize(col: TableColumn): number {
  switch (col.type) {
    case 'varchar':
      return Math.min(col.size ?? 255, APPWRITE_STRING_MAX);
    case 'text':
      return Math.min(col.size ?? APPWRITE_STRING_MAX, APPWRITE_STRING_MAX);
    case 'mediumtext':
      return Math.min(col.size ?? APPWRITE_STRING_MAX, APPWRITE_STRING_MAX);
    default:
      throw new Error(`stringColumnSize: not a string-like type (${col.type})`);
  }
}

/**
 * Create column only if missing. Uses listColumns first so we never call
 * create twice for the same key (Appwrite can return "maximum columns" instead
 * of 409 on duplicates).
 */
async function ensureColumn(
  db: TablesDB,
  databaseId: string,
  tableId: string,
  col: TableColumn,
  existingKeys: Set<string>
): Promise<void> {
  if (existingKeys.has(col.key)) {
    log(`Column already present: ${tableId}.${col.key}`);
    return;
  }
  try {
    if (col.type === 'varchar' || col.type === 'text' || col.type === 'mediumtext') {
      await db.createStringColumn({
        databaseId,
        tableId,
        key: col.key,
        size: stringColumnSize(col),
        required: col.required,
      });
    } else if (col.type === 'datetime') {
      await db.createDatetimeColumn({
        databaseId,
        tableId,
        key: col.key,
        required: col.required,
      });
    } else if (col.type === 'boolean') {
      await db.createBooleanColumn({
        databaseId,
        tableId,
        key: col.key,
        required: col.required,
      });
    } else if (col.type === 'integer') {
      await db.createIntegerColumn({
        databaseId,
        tableId,
        key: col.key,
        required: col.required,
      });
    } else {
      log('Skipping unknown column type: ' + col.type + ' (key: ' + col.key + ')');
      return;
    }
    existingKeys.add(col.key);
    log(`Added column: ${tableId}.${col.key}`);
  } catch (colErr) {
    const colErrObj = colErr as { code?: number; message?: string };
    if (colErrObj?.code === 409) {
      log(`Column already exists: ${tableId}.${col.key}`);
      existingKeys.add(col.key);
    } else {
      log(`Failed to create column ${tableId}.${col.key}: ${colErrObj?.message ?? String(colErr)}`);
      throw colErr;
    }
  }
}

type TableColumnType = 'varchar' | 'text' | 'mediumtext' | 'datetime' | 'boolean' | 'integer';

interface TableColumn {
  key: string;
  type: TableColumnType;
  /**
   * `varchar`: max length.
   * `text` / `mediumtext`: max length for the backing **string** column (≤ 16,383).
   */
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
      { key: 'userId', type: 'varchar', size: 255, required: true },
      /* JSON: targets, title, description, visibility, tags, platforms (≤ 16,383). */
      { key: 'document', type: 'text', size: 16_383, required: true },
    ],
  },
  {
    tableId: 'upload_jobs',
    name: 'Upload Jobs',
    columns: [
      { key: 'userId', type: 'varchar', size: 255, required: true },
      { key: 'draftId', type: 'varchar', size: 255, required: false },
      { key: 'r2Key', type: 'varchar', size: 1024, required: false },
      { key: 'status', type: 'varchar', size: 64, required: true },
      { key: 'errorMessage', type: 'text', size: 2000, required: false },
    ],
  },
  {
    tableId: 'user_profiles',
    name: 'User Profiles',
    columns: [
      { key: 'userId', type: 'varchar', size: 255, required: true },
      { key: 'email', type: 'varchar', size: 255, required: true },
      { key: 'isSupporter', type: 'boolean', required: true },
      { key: 'role', type: 'varchar', size: 32, required: true },
    ],
  },
  {
    tableId: 'connected_accounts',
    name: 'Connected Accounts',
    columns: [
      { key: 'userId', type: 'varchar', size: 255, required: true },
      { key: 'platform', type: 'varchar', size: 64, required: true },
      /* OAuth tokens are typically under a few KB; modest sizes stay under Appwrite row budget. */
      { key: 'accessToken', type: 'mediumtext', size: 4096, required: true },
      { key: 'refreshToken', type: 'mediumtext', size: 4096, required: true },
      { key: 'tokenExpiry', type: 'varchar', size: 64, required: true },
      { key: 'platformUserId', type: 'varchar', size: 255, required: true },
      { key: 'platformName', type: 'varchar', size: 500, required: true },
    ],
  },
  {
    tableId: 'upload_usage',
    name: 'Upload Usage',
    columns: [
      { key: 'userId', type: 'varchar', size: 255, required: true },
      { key: 'month', type: 'varchar', size: 7, required: true },
      { key: 'uploadCount', type: 'integer', required: true },
    ],
  },
  {
    tableId: 'platform_uploads',
    name: 'Platform Uploads',
    columns: [
      { key: 'uploadJobId', type: 'varchar', size: 255, required: true },
      { key: 'platform', type: 'varchar', size: 64, required: true },
      { key: 'status', type: 'varchar', size: 64, required: true },
      { key: 'platformVideoId', type: 'varchar', size: 255, required: false },
      { key: 'platformUrl', type: 'varchar', size: 2048, required: false },
      { key: 'document', type: 'text', size: 16_383, required: true },
      { key: 'scheduledAt', type: 'datetime', required: false },
      { key: 'errorMessage', type: 'text', size: 2000, required: false },
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
        log(`Created empty table: ${t.name} (${t.tableId}) — adding columns next…`);
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
    }

    let columnKeys = await fetchColumnKeys(db, DATABASE_ID, t.tableId);
    for (const col of t.columns) {
      await ensureColumn(db, DATABASE_ID, t.tableId, col, columnKeys);
    }
  }

  if (tablesCreatedThisRun.size > 0) {
    log('Waiting 4s before creating indexes (new table(s) just provisioned)…');
    await new Promise((r) => setTimeout(r, 4000));
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
