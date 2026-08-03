const Joi = require('joi');
const { emailSchema, phoneSchema } = require('./common.validator');

const registerSchema = Joi.object({
    email: emailSchema.required(),
    password: Joi.string().min(8).max(128).required(),
    fullName: Joi.string().min(2).max(255).trim().required(),
    phone: phoneSchema.optional().allow(null, ''),
});

const loginSchema = Joi.object({
    email: emailSchema.required(),
    password: Joi.string().required(),
});

const refreshSchema = Joi.object({
    refreshToken: Joi.string().required(),
});

const changePasswordSchema = Joi.object({
    oldPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).max(128).required().invalid(Joi.ref('oldPassword')),
});

const setPasswordSchema = Joi.object({
    newPassword: Joi.string().min(8).max(128).required(),
});

const logoutSchema = Joi.object({
    refreshToken: Joi.string().optional().allow(null, ''),
});

const googleMobileSchema = Joi.object({
    idToken: Joi.string().required(),
});

const forgotPasswordSchema = Joi.object({
    email: emailSchema.required(),
});

const resetPasswordSchema = Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().min(8).max(128).required(),
});

const oauthExchangeSchema = Joi.object({
    code: Joi.string().required(),
});

const verifyEmailSchema = Joi.object({
    token: Joi.string().required(),
});

const resendVerificationSchema = Joi.object({
    email: emailSchema.required(),
});

const updateProfileSchema = Joi.object({
    fullName: Joi.string().min(2).max(255).trim().optional(),
    phone: phoneSchema.optional().allow(null, ''),
    avatarUrl: Joi.string().uri().max(2048).optional().allow(null, ''),
    // Optimistic locking (optional): nếu client gửi, backend chỉ update khi updated_at khớp.
    expectedUpdatedAt: Joi.date().iso().optional(),
});

const sessionIdSchema = Joi.object({
    id: Joi.number().integer().positive().required(),
});

module.exports = {
    registerSchema,
    loginSchema,
    refreshSchema,
    changePasswordSchema,
    setPasswordSchema,
    logoutSchema,
    googleMobileSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    oauthExchangeSchema,
    verifyEmailSchema,
    resendVerificationSchema,
    updateProfileSchema,
    sessionIdSchema,
};
