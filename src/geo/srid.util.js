'use strict';

const SRID = Object.freeze({ WGS84: 4326, VN2000_TM3_107_45: 5899 });
const allowed = new Set(Object.values(SRID));
const assertSupportedSrid = (value) => {
    const srid = Number(value);
    if (!Number.isInteger(srid) || !allowed.has(srid)) {throw new TypeError(`Unsupported SRID: ${value}`);}
    return srid;
};
const transformPoint = async (db, { longitude, latitude, sourceSrid = SRID.WGS84, targetSrid }) => {
    const source = assertSupportedSrid(sourceSrid);
    const target = assertSupportedSrid(targetSrid);
    const x = Number(longitude);
    const y = Number(latitude);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {throw new TypeError('Coordinates must be finite numbers');}
    const { rows: [row] } = await db.query(
        'SELECT ST_X(g) AS x, ST_Y(g) AS y FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), $3), $4) AS g) t',
        [x, y, source, target]
    );
    return { x: Number(row.x), y: Number(row.y), srid: target };
};
module.exports = { SRID, assertSupportedSrid, transformPoint };