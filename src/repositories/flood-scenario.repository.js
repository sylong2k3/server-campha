'use strict';

/**
 * Data-access repository for `gis.flood_scenarios`.
 */

const db = require('../configs/database');

const findById = async (id, client = db) => {
    const { rows } = await client.query(
        `SELECT fs.*, l.name_vi AS layer_name_vi, l.geoserver_layer
           FROM gis.flood_scenarios fs
           LEFT JOIN gis.layers l ON l.code = fs.layer_code AND l.deleted_at IS NULL
          WHERE fs.id = $1`,
        [id],
    );
    return rows[0] || null;
};

const findByCode = async (code, client = db) => {
    const { rows } = await client.query(
        `SELECT fs.*, l.name_vi AS layer_name_vi, l.geoserver_layer
           FROM gis.flood_scenarios fs
           LEFT JOIN gis.layers l ON l.code = fs.layer_code AND l.deleted_at IS NULL
          WHERE fs.code = $1`,
        [code],
    );
    return rows[0] || null;
};

const create = async (data, client = db) => {
    const {
        code,
        nameVi,
        minRainfall = 0.0,
        maxRainfall = null,
        minTide = null,
        maxTide = null,
        layerCode,
        description = null,
        isActive = true,
    } = data;

    const { rows } = await client.query(
        `INSERT INTO gis.flood_scenarios (
            code,
            name_vi,
            min_rainfall,
            max_rainfall,
            min_tide,
            max_tide,
            layer_code,
            description,
            is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [code, nameVi, minRainfall, maxRainfall, minTide, maxTide, layerCode, description, isActive],
    );
    return rows[0];
};

const update = async (id, data, client = db) => {
    const current = await findById(id, client);
    if (!current) return null;

    const fields = [];
    const values = [];
    let idx = 1;

    const map = {
        code: 'code',
        nameVi: 'name_vi',
        minRainfall: 'min_rainfall',
        maxRainfall: 'max_rainfall',
        minTide: 'min_tide',
        maxTide: 'max_tide',
        layerCode: 'layer_code',
        description: 'description',
        isActive: 'is_active',
    };

    for (const [key, col] of Object.entries(map)) {
        if (data[key] !== undefined) {
            fields.push(`${col} = $${idx++}`);
            values.push(data[key]);
        }
    }

    if (fields.length === 0) return current;

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const sql = `UPDATE gis.flood_scenarios SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const { rows } = await client.query(sql, values);
    return rows[0];
};

const deleteScenario = async (id, client = db) => {
    const { rowCount } = await client.query('DELETE FROM gis.flood_scenarios WHERE id = $1', [id]);
    return rowCount > 0;
};

const listAll = async ({ page = 1, limit = 20, activeOnly = false, search = '' } = {}, client = db) => {
    const where = [];
    const values = [];
    let idx = 1;

    if (activeOnly) {
        where.push(`fs.is_active = true`);
    }

    if (search && search.trim()) {
        where.push(`(fs.name_vi ILIKE $${idx} OR fs.code ILIKE $${idx} OR fs.description ILIKE $${idx})`);
        values.push(`%${search.trim()}%`);
        idx++;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::INT FROM gis.flood_scenarios fs ${whereClause}`;
    const { rows: countRows } = await client.query(countSql, values);
    const total = countRows[0]?.count || 0;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const dataValues = [...values, limitNum, offset];
    const dataSql = `
        SELECT fs.*, l.name_vi AS layer_name_vi, l.geoserver_layer
          FROM gis.flood_scenarios fs
          LEFT JOIN gis.layers l ON l.code = fs.layer_code AND l.deleted_at IS NULL
        ${whereClause}
        ORDER BY fs.min_rainfall ASC, fs.id ASC
        LIMIT $${idx++} OFFSET $${idx++}
    `;
    const { rows } = await client.query(dataSql, dataValues);

    return {
        items: rows,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum) || 1,
        },
    };
};

/**
 * Match a scenario based on rainfall and tide values.
 * Evaluates active scenarios ordered by min_rainfall descending.
 */
const findMatchingScenario = async (rainfall, tide = null, client = db) => {
    const rainVal = Number(rainfall);
    const tideVal = tide !== null && tide !== undefined && tide !== '' ? Number(tide) : null;

    const { rows } = await client.query(
        `SELECT fs.*, l.name_vi AS layer_name_vi, l.geoserver_layer
           FROM gis.flood_scenarios fs
           LEFT JOIN gis.layers l ON l.code = fs.layer_code AND l.deleted_at IS NULL
          WHERE fs.is_active = true
          ORDER BY fs.min_rainfall DESC, fs.id DESC`,
    );

    if (rows.length === 0) return null;

    // Find first scenario where rainfall >= min_rainfall (and <= max_rainfall if set)
    // and tide condition matches if min_tide/max_tide set
    for (const sc of rows) {
        const minR = Number(sc.min_rainfall);
        const maxR = sc.max_rainfall !== null ? Number(sc.max_rainfall) : Infinity;
        const minT = sc.min_tide !== null ? Number(sc.min_tide) : -Infinity;
        const maxT = sc.max_tide !== null ? Number(sc.max_tide) : Infinity;

        const matchesRain = rainVal >= minR && rainVal <= maxR;
        const matchesTide = tideVal === null || (tideVal >= minT && tideVal <= maxT);

        if (matchesRain && matchesTide) {
            return sc;
        }
    }

    // Fallback to highest matching scenario by rainfall if tide constraint didn't strictly match
    for (const sc of rows) {
        const minR = Number(sc.min_rainfall);
        const maxR = sc.max_rainfall !== null ? Number(sc.max_rainfall) : Infinity;
        if (rainVal >= minR && rainVal <= maxR) {
            return sc;
        }
    }

    // Fallback to lowest scenario
    return rows[rows.length - 1];
};

module.exports = {
    findById,
    findByCode,
    create,
    update,
    deleteScenario,
    listAll,
    findMatchingScenario,
};
