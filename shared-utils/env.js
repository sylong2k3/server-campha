/**
 * =============================================================================
 * ENV PARSING HELPERS
 * =============================================================================
 * Nhóm helper nhỏ để đọc `process.env.*` an toàn với fallback.
 * Dùng chung bởi cả 3 migration workspace.
 * =============================================================================
 */

/** Parse ENV thành integer, trả fallback nếu không hợp lệ. */
const parseInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Parse ENV thành float, trả fallback nếu không hợp lệ. */
const parseFloatNumber = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Parse ENV thành boolean.
 * Chỉ chuỗi "true" (case-insensitive) mới là true.
 * Chuỗi rỗng / undefined / null → fallback.
 */
const parseBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === "") {return fallback;}
  return String(value).toLowerCase() === "true";
};

/** Parse ENV chứa JSON. Nếu không parse được → log warn, trả fallback. */
const parseJson = (value, fallback, contextLabel = "env") => {
  if (!value) {return fallback;}
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(
      `[env][${contextLabel}] Không phải JSON hợp lệ, dùng giá trị mặc định`,
      error.message,
    );
    return fallback;
  }
};

/** Parse ENV thành mảng chuỗi (comma-separated), trim + loại rỗng. */
const parseStringList = (value, fallback = []) => {
  if (!value) {return fallback;}
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

/** Throw nếu ENV thiếu — dùng cho biến critical. */
const requireEnv = (name, value = process.env[name]) => {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required ENV: ${name}`);
  }
  return value;
};

module.exports = {
  parseInteger,
  parseFloatNumber,
  parseBoolean,
  parseJson,
  parseStringList,
  requireEnv,
};
