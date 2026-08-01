const db = require('../../../configs/database');

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
        expect(rows.map((row) => row.filename)).toEqual([
            '000_init_schema.sql',
            '001_system_logs.sql',
            '002_campha_foundation.sql',
            '003_activity_log_actions.sql',
            '004_auth_security.sql',
            '005_ldap_auth.sql',
            '006_spatial_infrastructure.sql',
            '007_layer_management.sql',
            '008_remove_ldap_auth.sql',
        ]);
        expect(rows.every((row) => row.checksum?.trim().length === 64)).toBe(true);
    });

    test('5 role DB, chỉ TNMT đổi role và quyền raster khớp mục 2.1', async () => {
        const { rows } = await db.query(`
            SELECT code,
                   permissions #>> '{users,change_role}' AS can_change_role,
                   permissions #>> '{raster,create}' AS raster_create,
                   permissions #>> '{raster,delete}' AS raster_delete,
                   permissions #>> '{raster,categorize}' AS raster_categorize
            FROM auth.roles
            WHERE is_active = true
            ORDER BY code
        `);
        expect(rows.map((row) => row.code)).toEqual([
            'citizen', 'so_tnmt', 'so_xd', 'system_admin', 'ubnd_tp',
        ]);
        expect(rows.filter((row) => row.can_change_role === 'true').map((row) => row.code))
            .toEqual(['so_tnmt']);
        const rasterManagers = rows.filter((row) =>
            row.raster_create === 'true'
            && row.raster_delete === 'true'
            && row.raster_categorize === 'true'
        ).map((row) => row.code);
        expect(rasterManagers).toEqual(['so_tnmt', 'so_xd', 'system_admin', 'ubnd_tp']);
    });

    test('storage schema và EPSG:5899 hoạt động trên PostGIS thật', async () => {
        const { rows: [schema] } = await db.query(`
            SELECT to_regclass('core.file_objects') IS NOT NULL AS file_objects,
                   EXISTS (
                     SELECT 1 FROM spatial_ref_sys
                     WHERE srid = 5899 AND auth_name = 'EPSG' AND auth_srid = 5899
                   ) AS epsg_5899
        `);
        expect(schema).toEqual({ file_objects: true, epsg_5899: true });

        const { rows: [point] } = await db.query(`
            SELECT ST_X(round_trip) AS longitude, ST_Y(round_trip) AS latitude
            FROM (
              SELECT ST_Transform(
                ST_Transform(ST_SetSRID(ST_MakePoint(107.335, 21.010), 4326), 5899),
                4326
              ) AS round_trip
            ) t
        `);
        expect(Number(point.longitude)).toBeCloseTo(107.335, 6);
        expect(Number(point.latitude)).toBeCloseTo(21.010, 6);
    });

    test('multi-tenant, layer ACL và auth security schema tồn tại', async () => {
        const { rows: [schema] } = await db.query(`
            SELECT
              to_regclass('auth.organizations') IS NOT NULL AS organizations,
              to_regclass('gis.layers') IS NOT NULL AS layers,
              to_regclass('gis.layer_permissions') IS NOT NULL AS layer_permissions,
              to_regclass('auth.mfa_credentials') IS NOT NULL AS mfa_credentials,
              to_regclass('auth.mfa_recovery_codes') IS NOT NULL AS mfa_recovery_codes,
              to_regclass('auth.mfa_challenges') IS NOT NULL AS mfa_challenges,
              to_regclass('auth.ldap_identities') IS NULL AS ldap_removed,
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
              EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'auth' AND table_name = 'oauth_exchange_codes' AND column_name = 'mfa_required'
              ) AS oauth_mfa_required
        `);
        expect(schema).toEqual({
            organizations: true,
            layers: true,
            layer_permissions: true,
            mfa_credentials: true,
            mfa_recovery_codes: true,
            mfa_challenges: true,
            ldap_removed: true,
            users_org_id: true,
            token_version: true,
            lockout_level: true,
            oauth_mfa_required: true,
        });
    });
});
