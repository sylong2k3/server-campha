'use strict';

const Joi = require('joi');

const noHtml = (value, helpers) => (/[<>]/.test(value) ? helpers.error('string.html') : value);
const plain = (max) => Joi.string().trim().min(1).max(max).custom(noHtml);
const optionalPlain = (max) => Joi.string().trim().max(max).allow('', null).custom(noHtml);
const idParamsSchema = Joi.object({ id: Joi.number().integer().positive().required() });
const commentParamsSchema = Joi.object({ commentId: Joi.number().integer().positive().required() });
const pagination = {
    q: Joi.string().trim().min(1).max(100).optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
};
const publicListSchema = Joi.object(pagination);
const sortOrder = Joi.string().uppercase().valid('ASC', 'DESC').default('DESC');
const newsListSchema = Joi.object({
    ...pagination,
    sortBy: Joi.string()
        .valid('published_at', 'created_at', 'updated_at', 'title')
        .default('published_at'),
    sortOrder,
});
const newsAdminListSchema = Joi.object({
    ...pagination,
    status: Joi.string().valid('draft', 'published', 'archived').optional(),
    visibility: Joi.string().valid('public', 'internal').optional(),
    sortBy: Joi.string()
        .valid('published_at', 'created_at', 'updated_at', 'title')
        .default('published_at'),
    sortOrder,
});
const newsCreateSchema = Joi.object({
    title: plain(300).required(),
    summary: optionalPlain(1000).optional(),
    content: plain(100000).required(),
    visibility: Joi.string().valid('public', 'internal').default('public'),
    status: Joi.string().valid('draft', 'published', 'archived').default('draft'),
    publishedAt: Joi.date().iso().allow(null).optional(),
});
const newsUpdateSchema = newsCreateSchema
    .fork(['title', 'content'], (field) => field.optional())
    .keys({
        expectedUpdatedAt: Joi.date().iso().required(),
    })
    .min(2);
const commentCreateSchema = Joi.object({ content: plain(2000).required() });
const commentListSchema = Joi.object({
    page: pagination.page,
    limit: pagination.limit,
    status: Joi.string()
        .valid('pending', 'approved', 'rejected', 'all', 'PENDING', 'APPROVED', 'REJECTED', 'ALL')
        .insensitive()
        .optional()
        .allow('', null),
});
const commentModerateSchema = Joi.object({
    status: Joi.string().valid('approved', 'rejected').required(),
});
const documentCreateSchema = Joi.object({
    title: plain(300).required(),
    documentCode: plain(100).required(),
    issuingAgency: plain(300).required(),
    issuedAt: Joi.date().iso().allow(null).optional(),
    description: optionalPlain(5000).optional(),
    visibility: Joi.string().valid('public', 'internal').default('public'),
    fileObjectId: Joi.number().integer().positive().required(),
});
const documentUpdateSchema = documentCreateSchema
    .fork(['title', 'documentCode', 'issuingAgency', 'fileObjectId'], (field) => field.optional())
    .keys({
        visibility: Joi.string().valid('public', 'internal').optional(),
        fileObjectId: Joi.forbidden(),
        expectedUpdatedAt: Joi.date().iso().required(),
    })
    .or('title', 'documentCode', 'issuingAgency', 'issuedAt', 'description', 'visibility');
const visibilityListSchema = Joi.object({
    ...pagination,
    visibility: Joi.string().valid('public', 'internal').optional(),
});
const documentListSchema = Joi.object({
    ...pagination,
    sortBy: Joi.string()
        .valid('issued_at', 'created_at', 'updated_at', 'title', 'document_code')
        .default('issued_at'),
    sortOrder,
});
const adminDocumentListSchema = documentListSchema.keys({
    visibility: Joi.string().valid('public', 'internal').optional(),
});
const pdfMapListSchema = Joi.object({
    ...pagination,
    yearFrom: Joi.number().integer().min(1900).max(2200).optional(),
    yearTo: Joi.number().integer().min(1900).max(2200).optional(),
    scaleLabel: plain(100).optional(),
    sortBy: Joi.string().valid('id', 'year', 'created_at', 'updated_at', 'title').default('year'),
    sortOrder,
});
const adminPdfMapListSchema = pdfMapListSchema.keys({
    visibility: Joi.string().valid('public', 'internal').optional(),
});
const pdfMapCreateSchema = Joi.object({
    title: plain(300).required(),
    scaleLabel: plain(100).required(),
    mapYear: Joi.number().integer().min(1900).max(2200).required(),
    preparingAgency: plain(300).required(),
    description: optionalPlain(5000).optional(),
    visibility: Joi.string().valid('public', 'internal').default('public'),
    fileObjectId: Joi.number().integer().positive().required(),
});
const pdfMapUpdateSchema = pdfMapCreateSchema
    .fork(['title', 'scaleLabel', 'mapYear', 'preparingAgency', 'fileObjectId'], (field) =>
        field.optional(),
    )
    .keys({ expectedUpdatedAt: Joi.date().iso().required() })
    .min(2);
const deleteQuerySchema = Joi.object({
    expectedUpdatedAt: Joi.date().iso().required(),
    deleteFiles: Joi.boolean().default(false),
});
const downloadQuerySchema = Joi.object({
    expireSeconds: Joi.number().integer().min(60).max(900).default(300),
});

module.exports = {
    idParamsSchema,
    commentParamsSchema,
    publicListSchema,
    newsListSchema,
    newsAdminListSchema,
    newsCreateSchema,
    newsUpdateSchema,
    commentCreateSchema,
    commentListSchema,
    commentModerateSchema,
    documentCreateSchema,
    documentUpdateSchema,
    visibilityListSchema,
    documentListSchema,
    adminDocumentListSchema,
    pdfMapCreateSchema,
    pdfMapUpdateSchema,
    pdfMapListSchema,
    adminPdfMapListSchema,
    deleteQuerySchema,
    downloadQuerySchema,
};
