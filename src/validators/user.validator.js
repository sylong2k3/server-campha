const Joi = require('joi');
const { emailSchema, phoneSchema, strongPasswordSchema } = require('./common.validator');

const VALID_ROLES = ['system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd', 'citizen'];

const createUserSchema = Joi.object({
    authProvider: Joi.string().valid('local', 'ldap').default('local'),
    email: emailSchema.when('authProvider', { is: 'local', then: Joi.required(), otherwise: Joi.forbidden() }),
    password: strongPasswordSchema.when('authProvider', { is: 'local', then: Joi.required(), otherwise: Joi.forbidden() }),
    fullName: Joi.string().min(2).max(255).trim()
        .when('authProvider', { is: 'local', then: Joi.required(), otherwise: Joi.forbidden() }),
    directoryUsername: Joi.string().trim().max(255)
        .pattern(/^[A-Za-z0-9][A-Za-z0-9._@-]*$/)
        .when('authProvider', { is: 'ldap', then: Joi.required(), otherwise: Joi.forbidden() }),
    phone: phoneSchema.optional().allow(null, ''),
    roleCode: Joi.string().valid(...VALID_ROLES).default('citizen'),
});

const updateRoleSchema = Joi.object({
    roleCode: Joi.string().valid(...VALID_ROLES).required(),
});

const setActiveSchema = Joi.object({
    isActive: Joi.boolean().required(),
});

const resetPasswordAdminSchema = Joi.object({
    newPassword: strongPasswordSchema.required(),
});


const listUsersSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    roleCode: Joi.string().valid(...VALID_ROLES).optional(),
    isActive: Joi.boolean().optional(),
    q: Joi.string().trim().max(255).optional().allow(''),
    email: Joi.string().trim().max(255).optional().allow(''),
    sortBy: Joi.string()
        .valid('id', 'created_at', 'updated_at', 'email', 'full_name', 'phone', 'last_login_at')
        .optional()
        .default('created_at'),
    sortOrder: Joi.string().valid('ASC', 'DESC', 'asc', 'desc').optional().default('DESC'),
});

const userIdParamsSchema = Joi.object({
    id: Joi.number().integer().positive().required(),
});

module.exports = { createUserSchema, updateRoleSchema, setActiveSchema, resetPasswordAdminSchema, listUsersSchema, userIdParamsSchema };
