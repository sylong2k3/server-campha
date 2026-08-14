'use strict';
const db = require('../configs/database');
const createMany = async (userIds, { type, title, body, data }) => {
    const ids = Array.from(new Set(userIds)).filter(Boolean);
    if (!ids.length) {
        return [];
    }
    const { rows } = await db.query(
        `INSERT INTO core.notifications(user_id,type,title,body,data)
         SELECT uid, $2, $3, $4, $5::jsonb FROM UNNEST($1::bigint[]) AS uid
         RETURNING id,user_id,type,title,body,data,read_at,created_at`,
        [ids, type || 'general', title, body || null, JSON.stringify(data || {})],
    );
    return rows;
};
const listForUser = async (userId, { page = 1, limit = 20, unreadOnly = false } = {}) => {
    const offset = (page - 1) * limit;
    const where = unreadOnly ? 'user_id=$1 AND read_at IS NULL' : 'user_id=$1';
    const [{ rows }, {
        rows: [{ total }],
    }] = await Promise.all([
        db.query(
            `SELECT id,type,title,body,data,read_at,created_at
               FROM core.notifications WHERE ${where}
              ORDER BY created_at DESC, id DESC
              LIMIT $2 OFFSET $3`,
            [userId, limit, offset],
        ),
        db.query(`SELECT COUNT(*)::int AS total FROM core.notifications WHERE ${where}`, [userId]),
    ]);
    return { items: rows, total };
};
const countUnread = async (userId) => {
    const {
        rows: [row],
    } = await db.query(
        'SELECT COUNT(*)::int AS total FROM core.notifications WHERE user_id=$1 AND read_at IS NULL',
        [userId],
    );
    return row?.total || 0;
};
const markRead = async (id, userId) => {
    const {
        rows: [row],
    } = await db.query(
        `UPDATE core.notifications SET read_at=NOW()
          WHERE id=$1 AND user_id=$2 AND read_at IS NULL
          RETURNING id,read_at`,
        [id, userId],
    );
    return row || null;
};
const markAllRead = async (userId) => {
    const { rows } = await db.query(
        `UPDATE core.notifications SET read_at=NOW()
          WHERE user_id=$1 AND read_at IS NULL
          RETURNING id`,
        [userId],
    );
    return rows.length;
};
const remove = async (id, userId) => {
    const {
        rows: [row],
    } = await db.query(
        `DELETE FROM core.notifications
          WHERE id=$1 AND user_id=$2
          RETURNING id`,
        [id, userId],
    );
    return row || null;
};
module.exports = { createMany, listForUser, countUnread, markRead, markAllRead, remove };
