// Postgres SQLSTATE codes referenced directly by service-layer code (outside
// the generic mapping in src/middlewares/error-handler.js, which handles the
// catch-all 4xx translation for everything services don't need to branch on).
const PG_UNIQUE_VIOLATION = '23505';

module.exports = { PG_UNIQUE_VIOLATION };
