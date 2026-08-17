'use strict';

const db = require('../configs/database');

const SCENARIO_COLUMNS = `id, code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide,
                layer_code, description, is_active,
                current_rainfall, rainfall_source, current_tide, tide_source,
                created_at, updated_at`;

async function findById(id, client = db) {
    const res = await client.query(
        `SELECT ${SCENARIO_COLUMNS}
         FROM gis.flood_scenarios
         WHERE id = $1`,
        [id],
    );
    return res.rows[0] || null;
}

async function findByCode(code, client = db) {
    const res = await client.query(
        `SELECT ${SCENARIO_COLUMNS}
         FROM gis.flood_scenarios
         WHERE code = $1`,
        [code],
    );
    return res.rows[0] || null;
}

async function create(data, client = db) {
    const res = await client.query(
        `INSERT INTO gis.flood_scenarios (
            code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide,
            layer_code, description, is_active,
            current_rainfall, rainfall_source, current_tide, tide_source
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING ${SCENARIO_COLUMNS}`,
        [
            data.code,
            data.nameVi,
            data.minRainfall ?? 0.0,
            data.maxRainfall ?? null,
            data.minTide ?? null,
            data.maxTide ?? null,
            data.layerCode,
            data.description ?? null,
            data.isActive ?? true,
            data.currentRainfall ?? null,
            data.rainfallSource ?? 'MANUAL',
            data.currentTide ?? null,
            data.tideSource ?? 'MANUAL',
        ],
    );
    return res.rows[0];
}

async function update(id, data, client = db) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (data.code !== undefined) {
        fields.push(`code = $${idx++}`);
        values.push(data.code);
    }
    if (data.nameVi !== undefined) {
        fields.push(`name_vi = $${idx++}`);
        values.push(data.nameVi);
    }
    if (data.minRainfall !== undefined) {
        fields.push(`min_rainfall = $${idx++}`);
        values.push(data.minRainfall);
    }
    if (data.maxRainfall !== undefined) {
        fields.push(`max_rainfall = $${idx++}`);
        values.push(data.maxRainfall);
    }
    if (data.minTide !== undefined) {
        fields.push(`min_tide = $${idx++}`);
        values.push(data.minTide);
    }
    if (data.maxTide !== undefined) {
        fields.push(`max_tide = $${idx++}`);
        values.push(data.maxTide);
    }
    if (data.layerCode !== undefined) {
        fields.push(`layer_code = $${idx++}`);
        values.push(data.layerCode);
    }
    if (data.description !== undefined) {
        fields.push(`description = $${idx++}`);
        values.push(data.description);
    }
    if (data.isActive !== undefined) {
        fields.push(`is_active = $${idx++}`);
        values.push(data.isActive);
    }
    if (data.currentRainfall !== undefined) {
        fields.push(`current_rainfall = $${idx++}`);
        values.push(data.currentRainfall);
    }
    if (data.rainfallSource !== undefined) {
        fields.push(`rainfall_source = $${idx++}`);
        values.push(data.rainfallSource);
    }
    if (data.currentTide !== undefined) {
        fields.push(`current_tide = $${idx++}`);
        values.push(data.currentTide);
    }
    if (data.tideSource !== undefined) {
        fields.push(`tide_source = $${idx++}`);
        values.push(data.tideSource);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const res = await client.query(
        `UPDATE gis.flood_scenarios
         SET ${fields.join(', ')}
         WHERE id = $${idx}
         RETURNING ${SCENARIO_COLUMNS}`,
        values,
    );
    return res.rows[0] || null;
}

async function deleteScenario(id, client = db) {
    const res = await client.query(
        `DELETE FROM gis.flood_scenarios WHERE id = $1 RETURNING id`,
        [id],
    );
    return res.rowCount > 0;
}

async function listAll({ page = 1, limit = 20, activeOnly = false, search = null } = {}, client = db) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (activeOnly) {
        conditions.push(`is_active = true`);
    }

    if (search) {
        conditions.push(`(code ILIKE $${paramIndex} OR name_vi ILIKE $${paramIndex})`);
        params.push(`%${search}%`);
        paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await client.query(
        `SELECT COUNT(*) AS total FROM gis.flood_scenarios ${whereClause}`,
        params,
    );
    const total = parseInt(countRes.rows[0].total, 10);

    params.push(limit, offset);
    const dataRes = await client.query(
        `SELECT ${SCENARIO_COLUMNS}
         FROM gis.flood_scenarios
         ${whereClause}
         ORDER BY min_rainfall ASC, id ASC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        params,
    );

    return {
        items: dataRes.rows,
        pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
}

async function findMatchingScenario(rainfall, tide = null, client = db) {
    // Match by rainfall + tide (no is_active filter — simulation finds the best scenario regardless)
    const res = await client.query(
        `SELECT id, code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide,
                layer_code, description, is_active
         FROM gis.flood_scenarios
         WHERE $1 >= min_rainfall
           AND (max_rainfall IS NULL OR $1 <= max_rainfall)
           AND (
             $2::numeric IS NULL OR
             (min_tide IS NULL OR $2::numeric >= min_tide) AND
             (max_tide IS NULL OR $2::numeric <= max_tide)
           )
         ORDER BY min_rainfall DESC, min_tide DESC NULLS LAST
         LIMIT 1`,
        [rainfall, tide],
    );

    if (res.rows.length > 0) {
        return res.rows[0];
    }

    // Fallback: match by rainfall range only
    const fallbackRes = await client.query(
        `SELECT id, code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide,
                layer_code, description, is_active
         FROM gis.flood_scenarios
         WHERE $1 >= min_rainfall
           AND (max_rainfall IS NULL OR $1 <= max_rainfall)
         ORDER BY min_rainfall DESC
         LIMIT 1`,
        [rainfall],
    );

    if (fallbackRes.rows.length > 0) {
        return fallbackRes.rows[0];
    }

    // Final fallback: return scenario with lowest rainfall threshold
    const lowestRes = await client.query(
        `SELECT id, code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide,
                layer_code, description, is_active
         FROM gis.flood_scenarios
         ORDER BY min_rainfall ASC
         LIMIT 1`,
    );

    return lowestRes.rows[0] || null;
}

module.exports = {
    findById,
    findByCode,
    create,
    update,
    deleteScenario,
    listAll,
    findMatchingScenario,
};
