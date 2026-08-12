const db = require('../../../configs/database');
const { getMigrationFiles } = require('../../migrate');

describe('Cẩm Phả foundation database', () => {
    afterAll(async () => {
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('mọi migration đã áp dụng kèm SHA256 checksum', async () => {
        const { rows } = await db.query(`
            SELECT filename, checksum
            FROM core.schema_migrations
            ORDER BY filename
        `);
        expect(rows.map((row) => row.filename)).toEqual(
            getMigrationFiles().map((file) => file.filename),
        );
        expect(rows.every((row) => row.checksum?.trim().length === 64)).toBe(true);
    });

    test('5 role DB và toàn bộ quyền raster Sprint 6a khớp ma trận', async () => {
        const { rows } = await db.query(`
            SELECT code,
                   permissions #>> '{users,change_role}' AS can_change_role,
                   permissions #>> '{raster,create}' AS raster_create,
                   permissions #>> '{raster,delete}' AS raster_delete,
                   permissions #>> '{raster,categorize}' AS raster_categorize,
                   permissions #>> '{raster,read}' AS raster_read,
                   permissions #>> '{raster,compare}' AS raster_compare,
                   permissions #>> '{raster,search}' AS raster_search,
                   permissions #>> '{raster,download}' AS raster_download
            FROM auth.roles
            WHERE is_active = true
            ORDER BY code
        `);
        expect(rows.map((row) => row.code)).toEqual([
            'citizen',
            'so_tnmt',
            'so_xd',
            'system_admin',
            'ubnd_tp',
        ]);
        expect(rows.filter((row) => row.can_change_role === 'true').map((row) => row.code)).toEqual(
            ['so_tnmt'],
        );
        const adminActions = ['raster_create', 'raster_delete', 'raster_categorize', 'raster_read'];
        const rasterManagers = rows
            .filter((row) => adminActions.every((action) => row[action] === 'true'))
            .map((row) => row.code);
        expect(rasterManagers).toEqual(['so_tnmt', 'so_xd', 'system_admin', 'ubnd_tp']);
        expect(
            rows
                .filter((row) =>
                    ['raster_compare', 'raster_search', 'raster_download'].every(
                        (action) => row[action] === 'true',
                    ),
                )
                .map((row) => row.code),
        ).toEqual(['citizen', 'so_tnmt', 'so_xd', 'system_admin', 'ubnd_tp']);
        expect(rows.find((row) => row.code === 'citizen')).toMatchObject({
            raster_create: null,
            raster_delete: null,
            raster_categorize: null,
            raster_read: null,
        });
    });

    test('storage schema và EPSG:5899 hoạt động trên PostGIS thật', async () => {
        const {
            rows: [schema],
        } = await db.query(`
            SELECT to_regclass('core.file_objects') IS NOT NULL AS file_objects,
                   EXISTS (
                     SELECT 1 FROM spatial_ref_sys
                     WHERE srid = 5899 AND auth_name = 'EPSG' AND auth_srid = 5899
                   ) AS epsg_5899
        `);
        expect(schema).toEqual({ file_objects: true, epsg_5899: true });

        const {
            rows: [point],
        } = await db.query(`
            SELECT ST_X(round_trip) AS longitude, ST_Y(round_trip) AS latitude
            FROM (
              SELECT ST_Transform(
                ST_Transform(ST_SetSRID(ST_MakePoint(107.335, 21.010), 4326), 5899),
                4326
              ) AS round_trip
            ) t
        `);
        expect(Number(point.longitude)).toBeCloseTo(107.335, 6);
        expect(Number(point.latitude)).toBeCloseTo(21.01, 6);
    });

    test('multi-tenant, layer ACL và auth security schema khớp contract hiện hành', async () => {
        const { rows: authTables } = await db.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'
            ORDER BY table_name
        `);
        expect(authTables.map((row) => row.table_name)).toEqual([
            'activity_logs',
            'device_tokens',
            'email_verification_tokens',
            'oauth_exchange_codes',
            'organizations',
            'password_reset_tokens',
            'refresh_tokens',
            'roles',
            'social_accounts',
            'token_blacklist',
            'users',
        ]);

        const {
            rows: [schema],
        } = await db.query(`
            SELECT
              to_regclass('gis.layers') IS NOT NULL AS layers,
              to_regclass('gis.layer_permissions') IS NOT NULL AS layer_permissions,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'org_id'
              ) AS users_org_id,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'token_version'
              ) AS token_version,
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'lockout_level'
              ) AS lockout_level,
              pg_get_constraintdef(oid) AS activity_action_check
            FROM pg_constraint
            WHERE conrelid = 'auth.activity_logs'::regclass
              AND conname = 'activity_logs_action_check'
        `);
        expect(schema).toMatchObject({
            layers: true,
            layer_permissions: true,
            users_org_id: true,
            token_version: true,
            lockout_level: true,
        });
        const allowedActions = [...schema.activity_action_check.matchAll(/'([^']+)'/g)].map(
            (match) => match[1],
        );
        expect(allowedActions).toEqual([
            'register',
            'login',
            'login_failed',
            'logout',
            'refresh_token',
            'change_password',
            'set_password',
            'update_profile',
            'social_login',
            'social_link',
            'social_unlink',
            'account_locked',
            'account_unlocked',
            'force_logout',
            'session_revoked',
            'password_reset_request',
            'password_reset',
            'password_reset_failed',
            'email_verification_sent',
            'email_verified',
            'token_reuse_detected',
            'user_create',
            'user_role_change',
            'user_active_change',
            'user_delete',
            'admin_password_reset',
            'system_logs_cleanup',
            'map_feature_update',
            'map_feature_restore',
            'mobile_sync',
        ]);
    });
    test('giữ pgRouting extension, bỏ graph nội bộ và giữ schema đồng bộ', async () => {
        const {
            rows: [schema],
        } = await db.query(`
            SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgrouting') AS pgrouting,
                   to_regclass('gis.routing_networks') IS NULL AS no_routing_networks,
                   to_regclass('gis.routing_vertices') IS NULL AS no_routing_vertices,
                   to_regclass('gis.routing_edges') IS NULL AS no_routing_edges,
                   to_regclass('gis.feature_states') IS NOT NULL AS feature_states,
                   to_regclass('gis.feature_versions') IS NOT NULL AS feature_versions,
                   to_regclass('gis.mobile_sync_receipts') IS NOT NULL AS mobile_sync_receipts
        `);
        expect(Object.values(schema).every(Boolean)).toBe(true);
    });
    test('schema Registry API Sprint 13 tồn tại', async () => {
        const {
            rows: [schema],
        } = await db.query(`
            SELECT to_regclass('apikey.registries') IS NOT NULL AS registries,
                   to_regclass('apikey.keys') IS NOT NULL AS keys,
                   to_regclass('apikey.quota_windows') IS NOT NULL AS quota_windows,
                   to_regclass('apikey.call_logs') IS NOT NULL AS call_logs,
                   to_regclass('apikey.key_events') IS NOT NULL AS key_events,
                   to_regclass('apikey.feature_mutations') IS NOT NULL AS feature_mutations,
                   EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='gis' AND table_name='feature_versions' AND column_name='api_key_id') AS history_api_key
        `);
        expect(Object.values(schema).every(Boolean)).toBe(true);
    });
});
