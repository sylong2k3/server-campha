'use strict';

const db = require('../configs/database');

const mapCategoryRow = (row) => {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        key: row.key,
        name: row.name_vi,
        isVisible: row.is_visible !== false,
        layerCount: row.layer_count !== undefined ? Number(row.layer_count) : 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const list = async (options = {}, client = db) => {
    let actualOptions = options;
    let actualClient = client;
    if (options && typeof options.query === 'function') {
        actualClient = options;
        actualOptions = {};
    }
    const search = actualOptions?.search?.trim();
    if (search) {
        const term = `%${search}%`;
        const { rows } = await actualClient.query(
            `SELECT c.id, c.key, c.name_vi, COALESCE(c.is_visible, true) AS is_visible,
                    c.created_by, c.created_at, c.updated_at,
                    COUNT(l.id) FILTER (WHERE l.deleted_at IS NULL)::int AS layer_count
             FROM gis.layer_categories c
             LEFT JOIN gis.layers l ON l.category = c.key
             WHERE c.name_vi ILIKE $1 OR c.key ILIKE $1
             GROUP BY c.id, c.key, c.name_vi, c.is_visible, c.created_by, c.created_at, c.updated_at
             ORDER BY c.name_vi ASC, c.id ASC`,
            [term],
        );
        return rows.map(mapCategoryRow);
    }
    const { rows } = await actualClient.query(
        `SELECT c.id, c.key, c.name_vi, COALESCE(c.is_visible, true) AS is_visible,
                c.created_by, c.created_at, c.updated_at,
                COUNT(l.id) FILTER (WHERE l.deleted_at IS NULL)::int AS layer_count
         FROM gis.layer_categories c
         LEFT JOIN gis.layers l ON l.category = c.key
         GROUP BY c.id, c.key, c.name_vi, c.is_visible, c.created_by, c.created_at, c.updated_at
         ORDER BY c.name_vi ASC, c.id ASC`,
    );
    return rows.map(mapCategoryRow);
};

const findByKey = async (key, client = db) => {
    const { rows } = await client.query(
        `SELECT c.id, c.key, c.name_vi, COALESCE(c.is_visible, true) AS is_visible,
                c.created_by, c.created_at, c.updated_at,
                COUNT(l.id) FILTER (WHERE l.deleted_at IS NULL)::int AS layer_count
         FROM gis.layer_categories c
         LEFT JOIN gis.layers l ON l.category = c.key
         WHERE c.key = $1
         GROUP BY c.id, c.key, c.name_vi, c.is_visible, c.created_by, c.created_at, c.updated_at`,
        [key],
    );
    return mapCategoryRow(rows[0]);
};

const findByName = async (name, client = db) => {
    const { rows } = await client.query(
        `SELECT c.id, c.key, c.name_vi, COALESCE(c.is_visible, true) AS is_visible,
                c.created_by, c.created_at, c.updated_at,
                COUNT(l.id) FILTER (WHERE l.deleted_at IS NULL)::int AS layer_count
         FROM gis.layer_categories c
         LEFT JOIN gis.layers l ON l.category = c.key
         WHERE LOWER(TRIM(c.name_vi)) = LOWER(TRIM($1))
         GROUP BY c.id, c.key, c.name_vi, c.is_visible, c.created_by, c.created_at, c.updated_at`,
        [name],
    );
    return mapCategoryRow(rows[0]);
};

const create = async ({ key, nameVi, createdBy }, client = db) => {
    const { rows } = await client.query(
        `INSERT INTO gis.layer_categories (key, name_vi, is_visible, created_by)
         VALUES ($1, $2, true, $3)
         RETURNING id, key, name_vi, is_visible, created_by, created_at, updated_at`,
        [key, nameVi, createdBy || null],
    );
    return mapCategoryRow(rows[0]);
};

const updateVisibility = async (key, isVisible, client = db) => {
    const { rows } = await client.query(
        `UPDATE gis.layer_categories
         SET is_visible = $2, updated_at = NOW()
         WHERE key = $1
         RETURNING id, key, name_vi, is_visible, created_by, created_at, updated_at`,
        [key, isVisible],
    );
    return mapCategoryRow(rows[0]);
};

const countActiveLayers = async (key, client = db) => {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM gis.layers
         WHERE category = $1 AND deleted_at IS NULL`,
        [key],
    );
    return rows[0]?.count || 0;
};

const deleteByKey = async (key, client = db) => {
    const { rows } = await client.query(
        `DELETE FROM gis.layer_categories
         WHERE key = $1
         RETURNING id, key, name_vi`,
        [key],
    );
    return rows[0] ? { id: rows[0].id, key: rows[0].key, name: rows[0].name_vi } : null;
};

module.exports = {
    list,
    findByKey,
    findByName,
    create,
    updateVisibility,
    countActiveLayers,
    deleteByKey,
};
