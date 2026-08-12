'use strict';

const storageService = require('../services/storage.service');
const { OK, CREATED } = require('../core/success.response');
const { buildActor } = require('../utils/actor.util');

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
const deleteObject = async (req, res) => {
    const result = await storageService.deleteObject(Number(req.params.id), buildActor(req));
    OK(res, 'Đã xóa file', result);
};
module.exports = {
    createPresignedUpload,
    directUpload,
    commitUpload,
    getDownloadUrl,
    deleteObject,
};
