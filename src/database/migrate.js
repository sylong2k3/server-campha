const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('../configs/database');

const migrationsDir = path.join(__dirname, 'migrations');
const MIGRATION_LOCK_ID = 1485903001;

const calculateChecksum = (content) =>
    crypto.createHash('sha256').update(content, 'utf8').digest('hex');

const getMigrationFiles = () =>
    fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((filename) => {
            const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
            return { filename, sql, checksum: calculateChecksum(sql) };
        });

const ensureMigrationsTable = async (db = pool) => {
    await db.query(`
    CREATE SCHEMA IF NOT EXISTS core;

    CREATE TABLE IF NOT EXISTS core.schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64),
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE core.schema_migrations
      ADD COLUMN IF NOT EXISTS checksum CHAR(64);
  `);
};

const getExecutedMigrations = async (db = pool) => {
    const { rows } = await db.query(
        'SELECT filename, checksum, executed_at FROM core.schema_migrations ORDER BY filename',
    );
    return new Map(rows.map((row) => [row.filename, row]));
};

const backfillLegacyChecksums = async (db, executed, files) => {
    for (const file of files) {
        const record = executed.get(file.filename);
        if (record && !record.checksum) {
            await db.query(
                'UPDATE core.schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL',
                [file.filename, file.checksum],
            );
            record.checksum = file.checksum;
        }
    }
};

const assertChecksums = (executed, files) => {
    const filesByName = new Map(files.map((file) => [file.filename, file]));

    for (const [filename, record] of executed) {
        const file = filesByName.get(filename);
        if (!file) {
            throw new Error(`Applied migration file is missing: ${filename}`);
        }
        if (!record.checksum) {
            throw new Error(`Applied migration has no checksum: ${filename}`);
        }
        if (record.checksum.trim() !== file.checksum) {
            throw new Error(`Migration checksum mismatch: ${filename}`);
        }
    }
};

const prepareMigrationState = async (db) => {
    await ensureMigrationsTable(db);
    const files = getMigrationFiles();
    const executed = await getExecutedMigrations(db);
    await backfillLegacyChecksums(db, executed, files);
    assertChecksums(executed, files);
    return { files, executed };
};

const showStatus = async () => {
    const { files, executed } = await prepareMigrationState(pool);
    console.log('Migration status:');
    files.forEach((file) => {
        const record = executed.get(file.filename);
        console.log(`${record ? '[x]' : '[ ]'} ${file.filename}${record ? ' (checksum ok)' : ''}`);
    });
};

const runMigrations = async () => {
    const client = await pool.connect();
    let lockAcquired = false;

    try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        lockAcquired = true;
        const { files, executed } = await prepareMigrationState(client);

        for (const file of files) {
            if (executed.has(file.filename)) {
                console.log(`skip ${file.filename} (checksum ok)`);
                continue;
            }

            try {
                await client.query('BEGIN');
                await client.query(file.sql);
                await client.query(
                    'INSERT INTO core.schema_migrations (filename, checksum) VALUES ($1, $2)',
                    [file.filename, file.checksum],
                );
                await client.query('COMMIT');
                console.log(`done ${file.filename}`);
            } catch (error) {
                await client.query('ROLLBACK');
                console.error(`failed ${file.filename}: ${error.message}`);
                throw error;
            }
        }
    } finally {
        if (lockAcquired) {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
        }
        client.release();
    }
};

const main = async () => {
    try {
        if (process.argv.includes('--status')) {
            await showStatus();
        } else {
            await runMigrations();
        }
    } finally {
        await pool.end();
    }
};

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = {
    calculateChecksum,
    assertChecksums,
    ensureMigrationsTable,
    getMigrationFiles,
    runMigrations,
    showStatus,
};
