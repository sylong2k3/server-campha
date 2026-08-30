'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../helpers/async-handler');
const controller = require('../controllers/cms.controller');
const v = require('../validators/cms.validator');
const {
    optionalAuth,
    verifyToken,
    enforcePasswordChange,
} = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');

const strict = (schema, source = 'body') => validate(schema, source, { stripUnknown: false });
const commentLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
});
const publicRouter = Router();
publicRouter.use(optionalAuth);
publicRouter.get(
    '/news',
    strict(v.newsListSchema, 'query'),
    asyncHandler(controller.listPublicNews),
);
publicRouter.get(
    '/news/:id',
    strict(v.idParamsSchema, 'params'),
    asyncHandler(controller.getPublicNews),
);
publicRouter.get(
    '/news/:id/comments',
    strict(v.idParamsSchema, 'params'),
    strict(v.commentListSchema, 'query'),
    asyncHandler(controller.listPublicComments),
);
publicRouter.post(
    '/news/:id/comments',
    verifyToken,
    enforcePasswordChange,
    commentLimiter,
    strict(v.idParamsSchema, 'params'),
    strict(v.commentCreateSchema),
    asyncHandler(controller.createComment),
);
publicRouter.get(
    '/comments/:commentId',
    strict(v.commentParamsSchema, 'params'),
    asyncHandler(controller.getPublicComment),
);
publicRouter.get(
    '/news/comments/:commentId',
    strict(v.commentParamsSchema, 'params'),
    asyncHandler(controller.getPublicComment),
);
publicRouter.get(
    '/documents',
    strict(v.documentListSchema, 'query'),
    asyncHandler(controller.listDocuments),
);
publicRouter.get(
    '/documents/:id',
    strict(v.idParamsSchema, 'params'),
    asyncHandler(controller.getDocument),
);
publicRouter.get(
    '/documents/:id/download-url',
    strict(v.idParamsSchema, 'params'),
    strict(v.downloadQuerySchema, 'query'),
    asyncHandler(controller.documentDownload),
);
publicRouter.get(
    '/pdf-maps',
    strict(v.pdfMapListSchema, 'query'),
    asyncHandler(controller.listPdfMaps),
);
publicRouter.get(
    '/pdf-maps/:id',
    strict(v.idParamsSchema, 'params'),
    asyncHandler(controller.getPdfMap),
);
publicRouter.get(
    '/pdf-maps/:id/download-url',
    strict(v.idParamsSchema, 'params'),
    strict(v.downloadQuerySchema, 'query'),
    asyncHandler(controller.pdfMapDownload),
);

const adminRouter = Router();
adminRouter.use(verifyToken, enforcePasswordChange);
adminRouter.get(
    '/news',
    strict(v.newsAdminListSchema, 'query'),
    asyncHandler(controller.listAdminNews),
);
adminRouter.post('/news', strict(v.newsCreateSchema), asyncHandler(controller.createNews));
adminRouter.get(
    '/news/:id',
    strict(v.idParamsSchema, 'params'),
    asyncHandler(controller.getAdminNews),
);
adminRouter.patch(
    '/news/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.newsUpdateSchema),
    asyncHandler(controller.updateNews),
);
adminRouter.delete(
    '/news/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.deleteQuerySchema, 'query'),
    asyncHandler(controller.deleteNews),
);
adminRouter.get(
    '/comments',
    strict(v.commentListSchema, 'query'),
    asyncHandler(controller.listAllAdminComments),
);
adminRouter.get(
    '/news/comments',
    strict(v.commentListSchema, 'query'),
    asyncHandler(controller.listAllAdminComments),
);
adminRouter.get(
    '/news/:id/comments',
    strict(v.idParamsSchema, 'params'),
    strict(v.commentListSchema, 'query'),
    asyncHandler(controller.listAdminComments),
);
adminRouter.get(
    '/news/comments/:commentId',
    strict(v.commentParamsSchema, 'params'),
    asyncHandler(controller.getAdminComment),
);
adminRouter.patch(
    '/news/comments/:commentId',
    strict(v.commentParamsSchema, 'params'),
    strict(v.commentModerateSchema),
    asyncHandler(controller.moderateComment),
);
adminRouter.get(
    '/documents',
    strict(v.adminDocumentListSchema, 'query'),
    asyncHandler(controller.listAdminDocuments),
);
adminRouter.post(
    '/documents',
    strict(v.documentCreateSchema),
    asyncHandler(controller.createDocument),
);
adminRouter.get(
    '/documents/:id',
    strict(v.idParamsSchema, 'params'),
    asyncHandler(controller.getAdminDocument),
);
adminRouter.patch(
    '/documents/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.documentUpdateSchema),
    asyncHandler(controller.updateDocument),
);
adminRouter.delete(
    '/documents/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.deleteQuerySchema, 'query'),
    asyncHandler(controller.deleteDocument),
);
adminRouter.get(
    '/pdf-maps',
    strict(v.adminPdfMapListSchema, 'query'),
    asyncHandler(controller.listAdminPdfMaps),
);
adminRouter.post('/pdf-maps', strict(v.pdfMapCreateSchema), asyncHandler(controller.createPdfMap));
adminRouter.get(
    '/pdf-maps/:id',
    strict(v.idParamsSchema, 'params'),
    asyncHandler(controller.getAdminPdfMap),
);
adminRouter.patch(
    '/pdf-maps/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.pdfMapUpdateSchema),
    asyncHandler(controller.updatePdfMap),
);
adminRouter.delete(
    '/pdf-maps/:id',
    strict(v.idParamsSchema, 'params'),
    strict(v.deleteQuerySchema, 'query'),
    asyncHandler(controller.deletePdfMap),
);

module.exports = { publicRouter, adminRouter };
