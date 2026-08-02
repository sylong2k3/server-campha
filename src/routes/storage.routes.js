'use strict';

const { Router } = require('express');
const asyncHandler = require('../helpers/async-handler');
const storageController = require('../controllers/storage.controller');
const { verifyToken, enforcePasswordChange } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const {
    presignSchema,
    objectIdParamsSchema,
    downloadQuerySchema,
} = require('../validators/storage.validator');

const router = Router();
router.use(verifyToken, enforcePasswordChange);
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
