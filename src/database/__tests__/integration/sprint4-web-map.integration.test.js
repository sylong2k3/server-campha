if (process.env.DB_NAME !== 'campha_test') {
    throw new Error(
        `Sprint 4 write integration chỉ được chạy với DB_NAME=campha_test; received ${process.env.DB_NAME}`,
    );
}

const db = require('../../../configs/database');
const repository = require('../../../repositories/web-map.repository');

const PREFIX = 'it_s4_';
let suffix;
let publicLayer;
let privateLayer;
const citizen = { role: 'citizen' };
const ubnd = { role: 'ubnd_tp' };

const cleanup = async () => {
    const { rows } = await db.query(`SELECT table_name FROM gis.layers WHERE code LIKE $1`, [
        `${PREFIX}%`,
    ]);
    await db.query(`DELETE FROM gis.layers WHERE code LIKE $1`, [`${PREFIX}%`]);
    for (const row of rows) {
        if (/^[a-z][a-z0-9_]{0,62}$/.test(row.table_name)) {
            await db.query(`DROP TABLE IF EXISTS gis."${row.table_name}"`);
        }
    }
};

describe('Sprint 4 WebGIS integration', () => {
    beforeAll(async () => {
        await cleanup();
        suffix = Date.now();
        for (const visibility of ['public', 'private']) {
            const table = `${PREFIX}${visibility}_${suffix}`;
            await db.query(`CREATE TABLE gis."${table}" (
                source_fid BIGINT PRIMARY KEY, ten TEXT NOT NULL, noi_bo TEXT,
                geom geometry(Point, 4326) NOT NULL
            )`);
            await db.query(`INSERT INTO gis."${table}" VALUES
                (1, 'Phường Cẩm Trung', 'bí mật', ST_SetSRID(ST_MakePoint(107.32,21.01),4326)),
                (2, 'Phuong Cam Binh', 'bí mật 2', ST_SetSRID(ST_MakePoint(107.33,21.02),4326))`);
            const {
                rows: [layer],
            } = await db.query(
                `
                INSERT INTO gis.layers
                    (code,name_vi,category,geometry_type,srid,storage_kind,table_name,
                     is_public,publish_status,metadata,legend_config,min_zoom,max_zoom)
                VALUES ($1,$2,'hành chính','POINT',4326,'postgis',$3,$4,'published',
                    '{"displayFields":["ten"],"searchFields":["ten"],"importType":"shapefile"}',
                    '{"type":"single","label":"Phường"}',8,18)
                RETURNING *`,
                [
                    `${PREFIX}${visibility}_${suffix}`,
                    `Layer ${visibility}`,
                    table,
                    visibility === 'public',
                ],
            );
            if (visibility === 'public') {
                publicLayer = layer;
            } else {
                privateLayer = layer;
            }
        }
        await db.query(
            `INSERT INTO gis.layer_permissions (layer_id, role_code, can_view) VALUES ($1,'citizen',true)`,
            [privateLayer.id],
        );
    });

    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('migration 009 installs search extensions and safe basemap catalog', async () => {
        const { rows } = await db.query(
            `SELECT extname FROM pg_extension WHERE extname IN ('unaccent','pg_trgm') ORDER BY extname`,
        );
        expect(rows.map((row) => row.extname)).toEqual(['pg_trgm', 'unaccent']);
        const maps = await repository.basemaps();
        expect(maps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ code: 'osm_standard', provider: 'osm' }),
            ]),
        );
        expect(maps.every((map) => map.url_template.startsWith('https://'))).toBe(true);
    });

    test('anonymous receives public only; ACL role receives private too', async () => {
        const anonymous = await repository.catalog(null);
        expect(anonymous.map((layer) => layer.id)).toContain(publicLayer.id);
        expect(anonymous.map((layer) => layer.id)).not.toContain(privateLayer.id);
        const allowed = await repository.catalog(citizen);
        expect(allowed.map((layer) => layer.id)).toEqual(
            expect.arrayContaining([publicLayer.id, privateLayer.id]),
        );
        const denied = await repository.catalog(ubnd);
        expect(denied.map((layer) => layer.id)).not.toContain(privateLayer.id);
    });

    test('feature attributes hide non-allowlisted columns', async () => {
        const layer = await repository.accessibleLayer(publicLayer.id, null);
        const feature = await repository.featureById(layer, 1, false);
        expect(feature).toMatchObject({ source_fid: '1', ten: 'Phường Cẩm Trung' });
        expect(feature).not.toHaveProperty('noi_bo');
        expect(feature).not.toHaveProperty('geom');
    });

    test('Vietnamese unaccent/trigram search and bbox work on dynamic table', async () => {
        const layer = await repository.accessibleLayer(publicLayer.id, null);
        const matches = await repository.searchLayer(
            layer,
            'phuong cam trung',
            '107.2,20.9,107.5,21.2',
            10,
        );
        expect(matches[0]).toMatchObject({ label: 'Phường Cẩm Trung' });
        expect(matches[0].location).toEqual(expect.objectContaining({ type: 'Point' }));
    });

    test('identifier allowlist rejects injection', () => {
        expect(() => repository.qid('layer_ok')).not.toThrow();
        expect(() => repository.qid('layer;DROP TABLE')).toThrow('Unsafe database identifier');
    });
});
