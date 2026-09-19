'use strict';

const db = require('../configs/database');

const SCENARIO_MARKER_PATTERN = /^\[\[scenario:(hien_trang|cai_tao|quy_hoach)(?:;rcp:(rcp45|rcp85))?\]\]\s*/i;

function encodeDescription(description, type, rcp = null) {
    const clean = String(description || '').replace(SCENARIO_MARKER_PATTERN, '').trim();
    const scenarioType = ['hien_trang', 'cai_tao', 'quy_hoach'].includes(type) ? type : 'hien_trang';
    const scenarioRcp = scenarioType === 'quy_hoach' && ['rcp45', 'rcp85'].includes(rcp) ? rcp : null;
    const marker = `[[scenario:${scenarioType}${scenarioRcp ? `;rcp:${scenarioRcp}` : ''}]]`;
    return clean ? `${marker}\n${clean}` : marker;
}

function classifyScenario(row) {
    const marker = String(row.description || '').match(SCENARIO_MARKER_PATTERN);
    if (marker) {
        return { type: marker[1].toLowerCase(), rcp: marker[2]?.toLowerCase() || null };
    }
    const text = `${row.code || ''} ${row.name_vi || ''} ${row.description || ''} ${row.layer_code || ''}`.toLowerCase();
    if (text.includes('quy hoạch') || text.includes('quy hoach') || text.includes('2050')) {
        const rcp = text.includes('8.5') || text.includes('rcp85') ? 'rcp85' : text.includes('4.5') || text.includes('rcp45') ? 'rcp45' : null;
        return { type: 'quy_hoach', rcp };
    }
    if (text.includes('cải tạo') || text.includes('cai tao') || text.includes('thoát nước')) {
        return { type: 'cai_tao', rcp: null };
    }
    return { type: 'hien_trang', rcp: null };
}

function serialize(row) {
    if (!row) {
        return row;
    }
    const classification = classifyScenario(row);
    return {
        ...row,
        description: String(row.description || '').replace(SCENARIO_MARKER_PATTERN, '').trim() || null,
        ...classification,
    };
}

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
    return serialize(res.rows[0] || null);
}

async function findByCode(code, client = db) {
    const res = await client.query(
        `SELECT ${SCENARIO_COLUMNS}
         FROM gis.flood_scenarios
         WHERE code = $1`,
        [code],
    );
    return serialize(res.rows[0] || null);
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
            encodeDescription(data.description, data.type, data.rcp),
            data.isActive ?? true,
            data.currentRainfall ?? null,
            data.rainfallSource ?? 'MANUAL',
            data.currentTide ?? null,
            data.tideSource ?? 'MANUAL',
        ],
    );
    return serialize(res.rows[0]);
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
    const shouldUpdateDescription = data.description !== undefined || data.type !== undefined || data.rcp !== undefined;
    if (shouldUpdateDescription) {
        const current = await findById(id, client);
        fields.push(`description = $${idx++}`);
        values.push(encodeDescription(
            data.description !== undefined ? data.description : current?.description,
            data.type !== undefined ? data.type : current?.type,
            data.rcp !== undefined ? data.rcp : current?.rcp,
        ));
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
    return serialize(res.rows[0] || null);
}

async function deleteScenario(id, client = db) {
    const res = await client.query(
        `DELETE FROM gis.flood_scenarios WHERE id = $1 RETURNING id`,
        [id],
    );
    return res.rowCount > 0;
}

async function listAll({
    page = 1,
    limit = 20,
    activeOnly = false,
    search = null,
    type = null,
    rcp = null,
} = {}, client = db) {
    const conditions = [];
    const params = [];

    if (activeOnly) {
        conditions.push(`is_active = true`);
    }

    if (search) {
        const idx = params.length + 1;
        conditions.push(`(code ILIKE $${idx} OR name_vi ILIKE $${idx})`);
        params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataRes = await client.query(
        `SELECT ${SCENARIO_COLUMNS}
         FROM gis.flood_scenarios
         ${whereClause}
         ORDER BY min_rainfall ASC NULLS FIRST, id ASC`,
        params,
    );

    let items = dataRes.rows.map(serialize);

    if (type) {
        items = items.filter((item) => item.type === type);
    }
    if (rcp) {
        items = items.filter((item) => item.rcp === rcp);
    }

    const total = items.length;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const offset = (pageNum - 1) * limitNum;
    const paginatedItems = items.slice(offset, offset + limitNum);

    return {
        items: paginatedItems,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
        },
    };
}

async function deactivateAllActive({ types = null } = {}, client = db) {
    if (Array.isArray(types) && types.length > 0) {
        const activeRes = await client.query(
            `SELECT ${SCENARIO_COLUMNS}
             FROM gis.flood_scenarios
             WHERE is_active = true`,
        );
        const matched = activeRes.rows.map(serialize).filter((s) => types.includes(s.type));
        if (matched.length === 0) {
            return [];
        }
        const ids = matched.map((s) => s.id);
        const res = await client.query(
            `UPDATE gis.flood_scenarios
             SET is_active = false,
                 updated_at = NOW()
             WHERE id = ANY($1::int[])
             RETURNING ${SCENARIO_COLUMNS}`,
            [ids],
        );
        return res.rows.map(serialize);
    }

    const res = await client.query(
        `UPDATE gis.flood_scenarios
         SET is_active = false,
             updated_at = NOW()
         WHERE is_active = true
         RETURNING ${SCENARIO_COLUMNS}`,
    );
    return res.rows.map(serialize);
}

async function findMatchingScenario(rainfall, tide = null, client = db, { type = null } = {}) {
    const rainVal = Number(rainfall);
    if (!Number.isFinite(rainVal) || rainVal <= 0) {
        return null;
    }

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
         ORDER BY min_rainfall DESC, min_tide DESC NULLS LAST`,
        [rainVal, tide],
    );

    const matches = res.rows.map(serialize).filter((item) => !type || item.type === type);
    if (matches.length > 0) {
        return matches[0];
    }

    // Fallback: match by rainfall range only
    const fallbackRes = await client.query(
        `SELECT id, code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide,
                layer_code, description, is_active
         FROM gis.flood_scenarios
         WHERE $1 >= min_rainfall
           AND (max_rainfall IS NULL OR $1 <= max_rainfall)
         ORDER BY min_rainfall DESC`,
        [rainVal],
    );

    const fallbackMatches = fallbackRes.rows.map(serialize).filter((item) => !type || item.type === type);
    if (fallbackMatches.length > 0) {
        return fallbackMatches[0];
    }

    // Final fallback: return scenario with lowest rainfall threshold
    const lowestRes = await client.query(
        `SELECT id, code, name_vi, min_rainfall, max_rainfall, min_tide, max_tide,
                layer_code, description, is_active
         FROM gis.flood_scenarios
         ORDER BY min_rainfall ASC`,
    );

    const lowestMatches = lowestRes.rows.map(serialize).filter((item) => !type || item.type === type);
    return lowestMatches[0] || null;
}

module.exports = {
    classifyScenario,
    encodeDescription,
    serialize,
    findById,
    findByCode,
    create,
    update,
    deleteScenario,
    listAll,
    findMatchingScenario,
    deactivateAllActive,
};
