'use strict';

const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const storageController = require('../controllers/storage.controller');
const { optionalAuth, verifyToken, enforcePasswordChange } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const {
    presignSchema,
    directUploadHeadersSchema,
    objectIdParamsSchema,
    downloadQuerySchema,
} = require('../validators/storage.validator');

const router = Router();

router.get(
    '/objects/:id/file',
    optionalAuth,
    validate(objectIdParamsSchema, 'params'),
    asyncHandler(storageController.streamFile),
);

router.use(verifyToken, enforcePasswordChange);
router.post(
    '/uploads',
    validate(directUploadHeadersSchema, 'headers'),
    asyncHandler(storageController.directUpload),
);
router.post(
    '/uploads/presign',
    validate(presignSchema),
    asyncHandler(storageController.createPresignedUpload),
);
router.post(
    '/uploads/:id/commit',
    validate(objectIdParamsSchema, 'params'),
    asyncHandler(storageController.commitUpload),
);
router.get(
    '/objects/:id/download-url',
    validate(objectIdParamsSchema, 'params'),
    validate(downloadQuerySchema, 'query'),
    asyncHandler(storageController.getDownloadUrl),
);
router.delete(
    '/objects/:id',
    validate(objectIdParamsSchema, 'params'),
    asyncHandler(storageController.deleteObject),
);
module.exports = router;
