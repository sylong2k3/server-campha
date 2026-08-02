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
        // (107.7, 20.0) nằm giữa vùng lưới sinh ra ở beforeAll (lon 106.5–108.995,
        // lat 19.5–20.5) — điểm truy vấn phải nằm TRONG dữ liệu, nếu không cả
        // optimized lẫn legacy đều trả 0 và assertion count bằng nhau vô nghĩa.
        const point = [107.7, 20.0, 1000];
        const withSrid = [...point, 4326];
        // Mirror đúng biểu thức prefilter production trong
        // src/repositories/mobile-gis.repository.js `nearby()`: bbox native-SRID
        // của envelope-of-buffer, rồi lọc chính xác bằng ST_DWithin ở SRID mét.
        const optimized = `WITH point AS(
                SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),5899) metric
             ),target AS(
                SELECT metric, ST_Transform(ST_Envelope(ST_Buffer(metric,$3)),$4::integer) native_envelope
                FROM point
             )
             SELECT COUNT(*)::int count FROM gis.${table} t,target
             WHERE t.geom IS NOT NULL
               AND t.geom && target.native_envelope
               AND ST_DWithin(ST_Transform(t.geom,5899),target.metric,$3)`;
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
            db.query(optimized, withSrid),
            db.query(legacy, point),
            db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${optimized}`, withSrid),
        ]);
        // Bảo vệ khỏi false-positive dạng "0 giống 0": nếu fixture lệch ra ngoài
        // dữ liệu sinh ra, cả hai truy vấn cùng trả 0 và equality vẫn pass —
        // đây là chốt chặn để lần sau không lặp lại lỗi đó.
        expect(a.count).toBeGreaterThan(0);
        expect(a.count).toBe(b.count);
        expect(
            indexes(plan['QUERY PLAN'][0].Plan).some((x) =>
                String(x['Index Name']).includes(`${table}_geom_gix`),
            ),
        ).toBe(true);
    });
});
