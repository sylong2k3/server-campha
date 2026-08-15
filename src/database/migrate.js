const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('../configs/database');

const migrationsDir = path.join(__dirname, 'migrations');
const MIGRATION_LOCK_ID = 1485903001;

// SQL migrations are logically text files. Canonicalize line endings before
// storing their checksum so new migrations have the same checksum on Windows
// and Linux. Older deployments may already have a CRLF checksum; those are
// accepted during verification below without relaxing content integrity.
const normalizeLineEndings = (content) => String(content).replace(/\r\n?/g, '\n');
const hashContent = (content) => crypto.createHash('sha256').update(content, 'utf8').digest('hex');
const calculateChecksum = (content) => hashContent(normalizeLineEndings(content));
const calculateLegacyWindowsChecksum = (content) =>
    hashContent(normalizeLineEndings(content).replace(/\n/g, '\r\n'));

const getMigrationFiles = () =>
    fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort()
        .map((filename) => {
            const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
            return { filename, sql, checksum: calculateChecksum(sql) };
        });

const selectMigrationFiles = (files, filenames = []) => {
    if (!filenames.length) {
        return files;
    }

    const requested = new Set(filenames);
    const selected = files.filter((file) => requested.has(file.filename));
    const missing = filenames.filter(
        (filename) => !selected.some((file) => file.filename === filename),
    );
    if (missing.length) {
        throw new Error(`Unknown migration file(s): ${missing.join(', ')}`);
    }
    return selected;
};

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
        const expectedChecksums = new Set([file.checksum]);
        if (typeof file.sql === 'string') {
            // Backward compatibility for migrations that were first applied
            // from a Windows checkout before checksum normalization existed.
            expectedChecksums.add(calculateLegacyWindowsChecksum(file.sql));
        }
        if (!expectedChecksums.has(record.checksum.trim())) {
            throw new Error(`Migration checksum mismatch: ${filename}`);
        }
    }
};

const parseOnlyMigrationNames = (argv = process.argv) => {
    const option = argv.find((arg) => arg.startsWith('--only='));
    if (!option) {
        return [];
    }
    const names = option
        .slice('--only='.length)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    if (!names.length || names.some((name) => !/^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))) {
        throw new Error('Use --only=NNN_migration_name.sql[,NNN_other_migration.sql]');
    }
    return [...new Set(names)];
};

const parseRepairChecksumNames = (argv = process.argv) => {
    const option = argv.find((arg) => arg.startsWith('--repair-checksum='));
    if (!option) return [];
    const names = option
        .slice('--repair-checksum='.length)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    if (!names.length || names.some((name) => !/^\d{3}_[a-z0-9_-]+\.sql$/i.test(name))) {
        throw new Error('Use --repair-checksum=NNN_migration_name.sql[,NNN_other_migration.sql]');
    }
    return [...new Set(names)];
};

// Updates the stored checksum for already-applied idempotent migrations whose
// file content changed after they were first run. Only call this when you are
// certain the migration is safe to re-apply (or that only comments changed).
const repairChecksums = async (db, executed, allFiles, repair) => {
    const filesByName = new Map(allFiles.map((f) => [f.filename, f]));
    for (const filename of repair) {
        const file = filesByName.get(filename);
        if (!file) throw new Error(`Unknown migration file for --repair-checksum: ${filename}`);
        const record = executed.get(filename);
        if (!record) {
            console.warn(`warn  ${filename}: not yet applied — skipping checksum repair`);
            continue;
        }
        await db.query(
            'UPDATE core.schema_migrations SET checksum = $2 WHERE filename = $1',
            [filename, file.checksum],
        );
        record.checksum = file.checksum;
        console.log(`fixed ${filename} checksum`);
    }
};

const prepareMigrationState = async (db, { only = [], repair = [] } = {}) => {
    await ensureMigrationsTable(db);
    const allFiles = getMigrationFiles();
    const files = selectMigrationFiles(allFiles, only);
    const executed = await getExecutedMigrations(db);
    await backfillLegacyChecksums(db, executed, allFiles);
    if (repair.length) {
        await repairChecksums(db, executed, allFiles, repair);
    }
    // Recovery mode is deliberately narrow: it validates the selected files
    // only. This lets an operator apply a newly-required, unapplied migration
    // to a historic database whose unrelated migration checksum is already
    // known to be corrupt. Normal `migrate` still verifies the full history.
    if (only.length) {
        const selectedExecuted = new Map(
            files
                .filter((file) => executed.has(file.filename))
                .map((file) => [file.filename, executed.get(file.filename)]),
        );
        assertChecksums(selectedExecuted, files);
    } else {
        assertChecksums(executed, files);
    }
    return { files, executed };
};

const showStatus = async ({ only = [] } = {}) => {
    const { files, executed } = await prepareMigrationState(pool, { only });
    console.log('Migration status:');
    files.forEach((file) => {
        const record = executed.get(file.filename);
        console.log(`${record ? '[x]' : '[ ]'} ${file.filename}${record ? ' (checksum ok)' : ''}`);
    });
};

const runMigrations = async ({ only = [], repair = [] } = {}) => {
    const client = await pool.connect();
    let lockAcquired = false;

    try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        lockAcquired = true;
        if (only.length) {
            console.warn(
                `Applying selected migrations only: ${only.join(', ')}. ` +
                    'Unrelated historical checksums are not verified in this recovery mode.',
            );
        }
        if (repair.length) {
            console.warn(
                `Repairing checksums for: ${repair.join(', ')}. ` +
                    'Ensure these migrations are idempotent before proceeding.',
            );
        }
        const { files, executed } = await prepareMigrationState(client, { only, repair });

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
        const only = parseOnlyMigrationNames();
        const repair = parseRepairChecksumNames();
        if (process.argv.includes('--status')) {
            await showStatus({ only });
        } else {
            await runMigrations({ only, repair });
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
    calculateLegacyWindowsChecksum,
    assertChecksums,
    ensureMigrationsTable,
    getMigrationFiles,
    parseOnlyMigrationNames,
    parseRepairChecksumNames,
    repairChecksums,
    selectMigrationFiles,
    runMigrations,
    showStatus,
};
