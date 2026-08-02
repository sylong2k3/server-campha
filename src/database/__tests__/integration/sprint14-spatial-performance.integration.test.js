'use strict';
if (process.env.DB_NAME !== 'campha_test') {
    throw new Error('Sprint 14 performance integration requires campha_test');
}
const db = require('../../../configs/database');
const table = `s14_perf_${Date.now()}`;
const indexes = (node) => {
    const out = [];
    const walk = (x) => {
        if (!x || typeof x !== 'object') {
            return;
        }
        if (x['Node Type'] && String(x['Node Type']).includes('Index')) {
            out.push(x);
        }
        for (const value of Object.values(x)) {
            Array.isArray(value) ? value.forEach(walk) : walk(value);
        }
    };
    walk(node);
    return out;
};
describe('Sprint 14 spatial performance', () => {
    beforeAll(async () => {
        await db.query(
            `CREATE TABLE gis.${table}(id bigserial primary key,geom geometry(Point,4326) not null)`,
        );
        await db.query(
            `INSERT INTO gis.${table}(geom) SELECT ST_SetSRID(ST_MakePoint(106.5+(i%500)*0.005,19.5+(i/500)*0.005),4326) FROM generate_series(1,100000)i`,
        );
        await db.query(`CREATE INDEX ${table}_geom_gix ON gis.${table} USING GIST(geom)`);
        await db.query(`ANALYZE gis.${table}`);
    });
    afterAll(async () => {
        await db.query(`DROP TABLE IF EXISTS gis.${table}`);
        db.stopPoolMonitor();
        await db.pool.end();
    });
    test('native bbox prefilter uses GiST and preserves exact metric result', async () => {
        const params = [107.335, 21.01, 1000];
        const optimized = `SELECT COUNT(*)::int count FROM gis.${table} t WHERE t.geom && ST_Expand(ST_SetSRID(ST_MakePoint($1,$2),4326),$3*0.000012) AND ST_DWithin(ST_Transform(t.geom,5899),ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),5899),$3)`;
        const legacy = `SELECT COUNT(*)::int count FROM gis.${table} t WHERE ST_DWithin(ST_Transform(t.geom,5899),ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),5899),$3)`;
        const [
            {
                rows: [a],
            },
            {
                rows: [b],
            },
            {
                rows: [plan],
            },
        ] = await Promise.all([
            db.query(optimized, params),
            db.query(legacy, params),
            db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${optimized}`, params),
        ]);
        expect(a.count).toBe(b.count);
        expect(
            indexes(plan['QUERY PLAN'][0].Plan).some((x) =>
                String(x['Index Name']).includes(`${table}_geom_gix`),
            ),
        ).toBe(true);
    });
});
