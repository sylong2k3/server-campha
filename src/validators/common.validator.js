const Joi = require('joi');

// Fragment Joi dùng chung — tránh lặp lại pattern/chain giữa các validator.
const emailSchema = Joi.string().email().lowercase().trim();

const phoneSchema = Joi.string().pattern(/^[0-9+\-\s()]{8,20}$/);

// Mật khẩu do admin đặt hộ user khác (tạo mới/reset) — bắt buộc chữ thường +
// chữ hoa + số, khác với mật khẩu tự đăng ký (chỉ yêu cầu độ dài, xem auth.validator.js).
const strongPasswordSchema = Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/);

module.exports = { emailSchema, phoneSchema, strongPasswordSchema };
