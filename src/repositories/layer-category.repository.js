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
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
};

const list = async (client = db) => {
    const { rows } = await client.query(
        `SELECT id, key, name_vi, created_by, created_at, updated_at
         FROM gis.layer_categories
         ORDER BY name_vi ASC, id ASC`,
    );
    return rows.map(mapCategoryRow);
};

const findByKey = async (key, client = db) => {
    const { rows } = await client.query(
        `SELECT id, key, name_vi, created_by, created_at, updated_at
         FROM gis.layer_categories
         WHERE key = $1`,
        [key],
    );
    return mapCategoryRow(rows[0]);
};

const findByName = async (name, client = db) => {
    const { rows } = await client.query(
        `SELECT id, key, name_vi, created_by, created_at, updated_at
         FROM gis.layer_categories
         WHERE LOWER(TRIM(name_vi)) = LOWER(TRIM($1))`,
        [name],
    );
    return mapCategoryRow(rows[0]);
};

const create = async ({ key, nameVi, createdBy }, client = db) => {
    const { rows } = await client.query(
        `INSERT INTO gis.layer_categories (key, name_vi, created_by)
         VALUES ($1, $2, $3)
         RETURNING id, key, name_vi, created_by, created_at, updated_at`,
        [key, nameVi, createdBy || null],
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
    countActiveLayers,
    deleteByKey,
};
