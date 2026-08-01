const Joi = require('joi');
const { emailSchema, phoneSchema } = require('./common.validator');

const registerSchema = Joi.object({
    email: emailSchema.required(),
    password: Joi.string()
        .min(8)
        .max(128)
        .required(),
    fullName: Joi.string()
        .min(2)
        .max(255)
        .trim()
        .required(),
    phone: phoneSchema
        .optional()
        .allow(null, ''),
});

const loginSchema = Joi.object({
    email: emailSchema.required(),
    password: Joi.string()
        .required(),
});

const ldapLoginSchema = Joi.object({
    username: Joi.string()
        .trim()
        .max(255)
        .pattern(/^[A-Za-z0-9][A-Za-z0-9._@-]*$/)
        .required(),
    password: Joi.string()
        .max(256)
        .required(),
});

const refreshSchema = Joi.object({
    refreshToken: Joi.string()
        .required(),
});

const changePasswordSchema = Joi.object({
    oldPassword: Joi.string()
        .required(),
    newPassword: Joi.string()
        .min(8)
        .max(128)
        .required()
        .invalid(Joi.ref('oldPassword')),
});

const setPasswordSchema = Joi.object({
    newPassword: Joi.string()
        .min(8)
        .max(128)
        .required(),
});

const logoutSchema = Joi.object({
    refreshToken: Joi.string()
        .optional()
        .allow(null, ''),
});

const googleMobileSchema = Joi.object({
    idToken: Joi.string()
        .required(),
});

const forgotPasswordSchema = Joi.object({
    email: emailSchema.required(),
});

const resetPasswordSchema = Joi.object({
    token: Joi.string()
        .required(),
    newPassword: Joi.string()
        .min(8)
        .max(128)
        .required(),
});

const oauthExchangeSchema = Joi.object({
    code: Joi.string()
        .required(),
});

const verifyEmailSchema = Joi.object({
    token: Joi.string()
        .required(),
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

const mfaSetupSchema = Joi.object({
    challengeToken: Joi.string().min(40).max(128).required(),
});

const mfaConfirmSchema = Joi.object({
    challengeToken: Joi.string().min(40).max(128).required(),
    code: Joi.string().pattern(/^\d{6}$/).required(),
});

const mfaVerifySchema = Joi.object({
    challengeToken: Joi.string().min(40).max(128).required(),
    code: Joi.string().pattern(/^\d{6}$/).optional(),
    recoveryCode: Joi.string().pattern(/^[A-Z0-9_-]{12}$/i).optional(),
}).xor('code', 'recoveryCode');

const sessionIdSchema = Joi.object({
    id: Joi.number().integer().positive().required(),
});

module.exports = {
    registerSchema,
    loginSchema,
    ldapLoginSchema,
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
    mfaSetupSchema,
    mfaConfirmSchema,
    mfaVerifySchema,
    sessionIdSchema,
};
