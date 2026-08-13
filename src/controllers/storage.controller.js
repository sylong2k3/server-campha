'use strict';

const stream = require('stream');
const { promisify } = require('util');
const storageService = require('../services/storage.service');
const { OK, CREATED } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');

const pipeline = promisify(stream.pipeline);

const createPresignedUpload = async (req, res) => {
    const result = await storageService.createPresignedUpload(req.body, buildActor(req));
    CREATED(res, 'Đã tạo URL upload tạm thời', result);
};
const directUpload = async (req, res) => {
    const result = await storageService.directUpload(
        {
            stream: req,
            category: req.headers['x-file-category'],
            originalName: req.headers['x-file-name'],
            contentType: req.headers['content-type'],
            contentLength: Number(req.headers['content-length']),
        },
        buildActor(req),
    );
    CREATED(res, 'Tệp đã được tải lên, kiểm tra và lưu an toàn', result);
};
const commitUpload = async (req, res) => {
    const result = await storageService.commitUpload(Number(req.params.id), buildActor(req));
    OK(res, 'File đã được kiểm tra và lưu an toàn', result);
};
const getDownloadUrl = async (req, res) => {
    const result = await storageService.getDownloadUrl(
        Number(req.params.id),
        req.query.expireSeconds,
        buildActor(req),
    );
    OK(res, 'Đã tạo URL tải file', result);
};
const streamFile = async (req, res) => {
    const fileId = Number(req.params.id);
    const ticket = req.query.ticket;
    const actor = req.user ? buildActor(req) : null;
    const result = await storageService.streamFile(fileId, ticket, actor);
    res.setHeader('Content-Type', result.mimeType);
    if (result.sizeBytes) {
        res.setHeader('Content-Length', result.sizeBytes);
    }
    const encodedName = encodeURIComponent(result.originalName);
    res.setHeader(
        'Content-Disposition',
        `inline; filename="${encodedName}"; filename*=UTF-8''${encodedName}`,
    );
    await pipeline(result.stream, res);
};
const deleteObject = async (req, res) => {
    const result = await storageService.deleteObject(Number(req.params.id), buildActor(req));
    OK(res, 'File đã được đánh dấu xóa', result);
};
module.exports = {
    createPresignedUpload,
    directUpload,
    commitUpload,
    getDownloadUrl,
    streamFile,
    deleteObject,
};
