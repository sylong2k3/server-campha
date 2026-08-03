/**
 * Seed dữ liệu KTTV (Khí tượng Thủy văn) Cẩm Phả:
 *  - 6 trạm đo (khí tượng, thủy văn, đo mưa, thủy triều)
 *  - Thông số đo cho từng trạm
 *  - Ngưỡng cảnh báo
 *  - Số liệu quan trắc mẫu 30 ngày gần nhất (mỗi trạm × mỗi thông số, 1h/điểm)
 *
 * Yêu cầu: migration 025_kttv_data.sql đã chạy; seed 001_users.seed.js đã chạy.
 * Idempotent: bỏ qua trạm/ngưỡng đã tồn tại, chỉ bổ sung quan trắc thiếu.
 *
 * Chạy: node src/database/seeds/003_kttv.seed.js
 */
'use strict';

require('dotenv').config();
const db = require('../../configs/database');

const ADMIN_EMAIL = 'admin@campha.gov.vn';
const TNMT_EMAIL  = 'tnmt@campha.gov.vn';

// ---------------------------------------------------------------------------
//  Trạm đo KTTV Cẩm Phả
// ---------------------------------------------------------------------------
const STATIONS = [
    {
        code: 'CP-KT-001',
        name_vi: 'Trạm Khí tượng Cẩm Phả',
        station_type: 'meteorological',
        lng: 107.3368, lat: 21.0089,
        altitude_m: 18.5,
        address: 'Phường Cẩm Phú, thành phố Cẩm Phả, Quảng Ninh',
        managing_org: 'Đài Khí tượng Thủy văn tỉnh Quảng Ninh',
        installed_at: '2018-05-10',
        parameters: [
            { code: 'temperature',  primary: true,  sensor_model: 'Vaisala HMP155' },
            { code: 'humidity',     primary: true,  sensor_model: 'Vaisala HMP155' },
            { code: 'pressure',     primary: true,  sensor_model: 'Vaisala PTB330' },
            { code: 'wind_speed',   primary: true,  sensor_model: 'Vaisala WMT700' },
            { code: 'wind_dir',     primary: true,  sensor_model: 'Vaisala WMT700' },
            { code: 'rainfall',     primary: false, sensor_model: 'OTT Pluvio²' },
        ],
        thresholds: [
            { param: 'wind_speed',  level: 'caution',   value: 10,  dir: 'over' },
            { param: 'wind_speed',  level: 'warning',   value: 17,  dir: 'over' },
            { param: 'wind_speed',  level: 'danger',    value: 24,  dir: 'over' },
            { param: 'temperature', level: 'caution',   value: 35,  dir: 'over' },
            { param: 'temperature', level: 'warning',   value: 38,  dir: 'over' },
        ],
    },
    {
        code: 'CP-MUA-001',
        name_vi: 'Trạm đo mưa Quang Hanh',
        station_type: 'rainfall',
        lng: 107.2841, lat: 21.0312,
        altitude_m: 42.0,
        address: 'Phường Quang Hanh, thành phố Cẩm Phả, Quảng Ninh',
        managing_org: 'Đài Khí tượng Thủy văn tỉnh Quảng Ninh',
        installed_at: '2020-11-15',
        parameters: [
            { code: 'rainfall',     primary: true,  sensor_model: 'OTT Pluvio² 400' },
            { code: 'temperature',  primary: false, sensor_model: 'Davis 6382' },
            { code: 'humidity',     primary: false, sensor_model: 'Davis 6382' },
        ],
        thresholds: [
            { param: 'rainfall', level: 'caution',   value: 25,  dir: 'over' },
            { param: 'rainfall', level: 'warning',   value: 50,  dir: 'over' },
            { param: 'rainfall', level: 'danger',    value: 100, dir: 'over' },
            { param: 'rainfall', level: 'emergency', value: 200, dir: 'over' },
        ],
    },
    {
        code: 'CP-TV-001',
        name_vi: 'Trạm đo mực nước sông Mông Dương',
        station_type: 'hydrological',
        lng: 107.3756, lat: 21.0523,
        altitude_m: 3.2,
        address: 'Phường Mông Dương, thành phố Cẩm Phả, Quảng Ninh',
        managing_org: 'Đài Khí tượng Thủy văn tỉnh Quảng Ninh',
        installed_at: '2019-03-20',
        parameters: [
            { code: 'water_level',  primary: true,  sensor_model: 'OTT PLS 500' },
            { code: 'flow_rate',    primary: true,  sensor_model: 'OTT MF pro' },
            { code: 'rainfall',     primary: false, sensor_model: 'OTT Pluvio² 200' },
        ],
        thresholds: [
            { param: 'water_level', level: 'caution',   value: 2.5,  dir: 'over' },
            { param: 'water_level', level: 'warning',   value: 3.5,  dir: 'over' },
            { param: 'water_level', level: 'danger',    value: 4.5,  dir: 'over' },
            { param: 'water_level', level: 'emergency', value: 5.5,  dir: 'over' },
        ],
    },
    {
        code: 'CP-MUA-002',
        name_vi: 'Trạm đo mưa Cẩm Thịnh',
        station_type: 'rainfall',
        lng: 107.3124, lat: 21.0198,
        altitude_m: 28.7,
        address: 'Phường Cẩm Thịnh, thành phố Cẩm Phả, Quảng Ninh',
        managing_org: 'Sở Tài nguyên và Môi trường Quảng Ninh',
        installed_at: '2021-07-01',
        parameters: [
            { code: 'rainfall',     primary: true,  sensor_model: 'Hobo RG3-M' },
            { code: 'temperature',  primary: false, sensor_model: 'Onset U23-001' },
        ],
        thresholds: [
            { param: 'rainfall', level: 'caution',   value: 25,  dir: 'over' },
            { param: 'rainfall', level: 'warning',   value: 50,  dir: 'over' },
            { param: 'rainfall', level: 'danger',    value: 100, dir: 'over' },
            { param: 'rainfall', level: 'emergency', value: 200, dir: 'over' },
        ],
    },
    {
        code: 'CP-TRIEU-001',
        name_vi: 'Trạm thủy triều Cảng than Cẩm Phả',
        station_type: 'tide',
        lng: 107.3452, lat: 20.9978,
        altitude_m: 0.0,
        address: 'Cảng than Cẩm Phả, thành phố Cẩm Phả, Quảng Ninh',
        managing_org: 'Đài Khí tượng Thủy văn tỉnh Quảng Ninh',
        installed_at: '2022-01-10',
        parameters: [
            { code: 'tide_level',   primary: true,  sensor_model: 'KISTERS SEBA Dipper-M' },
            { code: 'wind_speed',   primary: false, sensor_model: 'Aanderaa 4920' },
            { code: 'wind_dir',     primary: false, sensor_model: 'Aanderaa 4920' },
        ],
        thresholds: [
            { param: 'tide_level', level: 'caution',   value: 2.8,  dir: 'over' },
            { param: 'tide_level', level: 'warning',   value: 3.4,  dir: 'over' },
            { param: 'tide_level', level: 'danger',    value: 4.0,  dir: 'over' },
        ],
    },
    {
        code: 'CP-MUA-003',
        name_vi: 'Trạm đo mưa Dương Huy',
        station_type: 'rainfall',
        lng: 107.2654, lat: 21.0641,
        altitude_m: 85.3,
        address: 'Phường Dương Huy, thành phố Cẩm Phả, Quảng Ninh',
        managing_org: 'Sở Tài nguyên và Môi trường Quảng Ninh',
        installed_at: '2023-04-05',
        parameters: [
            { code: 'rainfall',     primary: true,  sensor_model: 'Pessl iMETOS IMT280B' },
            { code: 'temperature',  primary: false, sensor_model: 'Pessl iMETOS' },
            { code: 'humidity',     primary: false, sensor_model: 'Pessl iMETOS' },
        ],
        thresholds: [
            { param: 'rainfall', level: 'caution',   value: 25,  dir: 'over' },
            { param: 'rainfall', level: 'warning',   value: 50,  dir: 'over' },
            { param: 'rainfall', level: 'danger',    value: 100, dir: 'over' },
            { param: 'rainfall', level: 'emergency', value: 200, dir: 'over' },
        ],
    },
];

// ---------------------------------------------------------------------------
//  Sinh giá trị quan trắc ngẫu nhiên có thực tế
// ---------------------------------------------------------------------------
function makeObservations(stationId, paramId, paramCode, hourCount) {
    const rows = [];
    const now  = new Date();

    // Biên giá trị điển hình cho từng thông số
    const spec = {
        rainfall:    { base: 0,    amp: 0,    noise: 0.5,  floor: 0 },
        water_level: { base: 1.2,  amp: 0.6,  noise: 0.08, floor: 0.2 },
        temperature: { base: 28,   amp: 5,    noise: 0.4,  floor: 15 },
        humidity:    { base: 80,   amp: 12,   noise: 1.2,  floor: 40 },
        wind_speed:  { base: 2.5,  amp: 2,    noise: 0.5,  floor: 0 },
        wind_dir:    { base: 180,  amp: 80,   noise: 10,   floor: 0 },
        pressure:    { base: 1012, amp: 4,    noise: 0.2,  floor: 980 },
        flow_rate:   { base: 5,    amp: 3,    noise: 0.3,  floor: 0.5 },
        tide_level:  { base: 2.0,  amp: 1.5,  noise: 0.05, floor: 0 },
    };
    const s = spec[paramCode] || { base: 10, amp: 5, noise: 1, floor: 0 };

    // Sự kiện mưa lớn giả lập: ngày 14 và 22 trước (giờ 0–12)
    const rainEvent1 = hourCount - 14 * 24;
    const rainEvent2 = hourCount - 22 * 24;

    for (let h = hourCount - 1; h >= 0; h--) {
        const ts  = new Date(now.getTime() - h * 3600 * 1000);
        const hour = ts.getUTCHours();
        const sin  = Math.sin((hour / 24) * 2 * Math.PI);

        let v;
        if (paramCode === 'rainfall') {
            // Mưa rải rác, đợt mưa lớn 2 lần
            let base = Math.random() < 0.15 ? Math.random() * 3 : 0;
            if (h >= rainEvent1 - 12 && h <= rainEvent1) base = Math.random() * 12 + 2;
            if (h >= rainEvent2 - 8  && h <= rainEvent2) base = Math.random() * 18 + 4;
            v = base;
        } else {
            v = s.base + sin * s.amp + (Math.random() - 0.5) * 2 * s.noise;
            if (paramCode === 'wind_dir') v = (v + 360) % 360;
            if (v < s.floor) v = s.floor;
        }

        rows.push([stationId, paramId, ts.toISOString(), Number(v.toFixed(3)), 'A', 'auto']);
    }
    return rows;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
(async () => {
    try {
        const admin = await (async () => {
            const { rows } = await db.query(
                `SELECT id FROM auth.users WHERE lower(email)=lower($1) AND deleted_at IS NULL`,
                [ADMIN_EMAIL],
            );
            if (!rows[0]) throw new Error(`Không tìm thấy user: ${ADMIN_EMAIL}`);
            return rows[0];
        })();
        const tnmt = await (async () => {
            const { rows } = await db.query(
                `SELECT id FROM auth.users WHERE lower(email)=lower($1) AND deleted_at IS NULL`,
                [TNMT_EMAIL],
            );
            if (!rows[0]) throw new Error(`Không tìm thấy user: ${TNMT_EMAIL}`);
            return rows[0];
        })();

        // Lấy map code→id của parameters
        const { rows: paramRows } = await db.query(`SELECT id, code FROM kttv.parameters`);
        const paramMap = Object.fromEntries(paramRows.map(r => [r.code, r.id]));

        let stationCount = 0;
        let obsTotal     = 0;

        for (const st of STATIONS) {
            // Upsert trạm
            let stationId;
            const { rows: exist } = await db.query(
                `SELECT id FROM kttv.stations WHERE code=$1`, [st.code],
            );

            if (exist[0]) {
                stationId = exist[0].id;
                console.log(`  [SKIP] Trạm đã tồn tại: ${st.code}`);
            } else {
                const { rows: ins } = await db.query(
                    `INSERT INTO kttv.stations
                         (code, name_vi, station_type, status, location, altitude_m,
                          address, managing_org, installed_at)
                     VALUES ($1,$2,$3,'active',
                             ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
                             $6,$7,$8,$9)
                     RETURNING id`,
                    [st.code, st.name_vi, st.station_type,
                     st.lng, st.lat, st.altitude_m,
                     st.address, st.managing_org, st.installed_at],
                );
                stationId = ins[0].id;
                stationCount++;
                console.log(`  [OK]   Trạm mới: ${st.code} — ${st.name_vi}`);
            }

            // Upsert station_parameters
            for (const p of st.parameters) {
                const paramId = paramMap[p.code];
                if (!paramId) { console.warn(`    [WARN] Parameter không tồn tại: ${p.code}`); continue; }
                await db.query(
                    `INSERT INTO kttv.station_parameters(station_id,parameter_id,is_primary,sensor_model)
                     VALUES($1,$2,$3,$4)
                     ON CONFLICT (station_id, parameter_id) DO UPDATE
                         SET is_primary=$3, sensor_model=$4`,
                    [stationId, paramId, p.primary, p.sensor_model || null],
                );
            }

            // Upsert ngưỡng cảnh báo
            for (const t of st.thresholds) {
                const paramId = paramMap[t.param];
                if (!paramId) continue;
                const setBy = st.managing_org.includes('Sở') ? tnmt.id : admin.id;
                await db.query(
                    `INSERT INTO kttv.alert_thresholds
                         (station_id, parameter_id, level, threshold, direction, is_active, set_by)
                     VALUES($1,$2,$3,$4,$5,true,$6)
                     ON CONFLICT (station_id,parameter_id,level,direction) DO UPDATE
                         SET threshold=$4, is_active=true`,
                    [stationId, paramId, t.level, t.value, t.dir || 'over', setBy],
                );
            }

            // Sinh dữ liệu quan trắc 30 ngày (720 giờ)
            const HOURS = 720;
            for (const p of st.parameters) {
                const paramId = paramMap[p.code];
                if (!paramId) continue;

                // Kiểm tra đã có dữ liệu chưa
                const { rows: obsExist } = await db.query(
                    `SELECT COUNT(*)::int cnt FROM kttv.observations
                     WHERE station_id=$1 AND parameter_id=$2
                       AND observed_at >= NOW() - INTERVAL '30 days'`,
                    [stationId, paramId],
                );
                if (obsExist[0].cnt >= HOURS * 0.9) {
                    console.log(`    [SKIP] Quan trắc đã đủ: ${st.code}/${p.code}`);
                    continue;
                }

                const obsRows = makeObservations(stationId, paramId, p.code, HOURS);

                // Batch insert 200 rows mỗi lần
                const BATCH = 200;
                for (let i = 0; i < obsRows.length; i += BATCH) {
                    const batch = obsRows.slice(i, i + BATCH);
                    const vals  = batch.map((_, j) => {
                        const base = j * 6;
                        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6})`;
                    }).join(',');
                    const flat = batch.flat();
                    await db.query(
                        `INSERT INTO kttv.observations
                             (station_id,parameter_id,observed_at,value,quality_flag,source)
                         VALUES ${vals}
                         ON CONFLICT DO NOTHING`,
                        flat,
                    );
                }
                obsTotal += obsRows.length;
                console.log(`    [OK]   Quan trắc ${st.code}/${p.code}: ${obsRows.length} điểm`);
            }
        }

        console.log(`\nSeed KTTV hoàn tất:`);
        console.log(`  Trạm mới      : ${stationCount}/${STATIONS.length}`);
        console.log(`  Điểm quan trắc: ${obsTotal}`);

        await db.pool.end();
        process.exit(0);
    } catch (e) {
        console.error('SEED KTTV FAILED:', e.message, e.stack);
        await db.pool.end().catch(() => {});
        process.exit(1);
    }
})();
