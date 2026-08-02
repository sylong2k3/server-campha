const db = require('../configs/database');

const create = async ({ level = 'info', source, message, metadata, userId, ipAddress }) => {
    const { rows } = await db.query(
        `INSERT INTO core.system_logs (level, source, message, metadata, user_id, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, level, source, message, created_at`,
        [level, source, message, JSON.stringify(metadata || {}), userId || null, ipAddress || null],
    );
    return rows[0];
};

const _escapeLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const _buildFilter = ({ level, source, q, dateFrom, dateTo }, startIdx = 1) => {
    const conditions = [];
    const params = [];
    let idx = startIdx;

    if (level) {
        conditions.push(`level = $${idx++}`);
        params.push(level);
    }
    if (source) {
        conditions.push(`source = $${idx++}`);
        params.push(source);
    }
    if (dateFrom) {
        conditions.push(`created_at >= $${idx++}`);
        params.push(dateFrom);
    }
    if (dateTo) {
        conditions.push(`created_at <= $${idx++}`);
        params.push(dateTo);
    }
    if (q) {
        const likeValue = `%${_escapeLike(String(q).toLowerCase())}%`;
        conditions.push(`LOWER(message) LIKE $${idx++} ESCAPE '\\'`);
        params.push(likeValue);
    }

    return {
        where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        params,
        nextIdx: idx,
    };
};

const findAll = async ({ level, source, q, dateFrom, dateTo, page = 1, limit = 20 } = {}) => {
    const filter = { level, source, q, dateFrom, dateTo };
    const { where, params, nextIdx } = _buildFilter(filter);
    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const { rows } = await db.query(
        `SELECT id, level, source, message, metadata, user_id, ip_address, created_at,
                COUNT(*) OVER()::int AS total_count
         FROM core.system_logs
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
        params,
    );

    if (rows.length === 0) {
        const total = offset > 0 ? await countAll(filter) : 0;
        return { items: [], total };
    }

    const total = rows[0].total_count;
    const items = rows.map(({ total_count: _totalCount, ...row }) => row);
    return { items, total };
};

const countAll = async ({ level, source, q, dateFrom, dateTo } = {}) => {
    const { where, params } = _buildFilter({ level, source, q, dateFrom, dateTo });
    const { rows } = await db.query(
        `SELECT COUNT(*)::int AS total FROM core.system_logs ${where}`,
        params,
    );
    return rows[0]?.total || 0;
};

const deleteOlderThan = async (days) => {
    const { rowCount } = await db.query(
        `DELETE FROM core.system_logs WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
        [days],
    );
    return rowCount;
};

module.exports = { create, findAll, countAll, deleteOlderThan };
