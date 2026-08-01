'use strict';

const repository = require('../repositories/remote-sensing.repository');
const minioService = require('./minio.service');
const systemLogger = require('../utils/systemLogger.util');
const { Api403Error, Api404Error, Api409Error, Api422Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');
const has = (actor, action) => actor?.permissions?.raster?.[action] === true;
const requirePermission = (actor, action) => { if (!has(actor, action)) { throw new Api403Error(t('satellite_forbidden', actor?.lang)); } };
const audit = (action, actor, metadata) => systemLogger.logInfo('remote_sensing', action, { actorId: actor.id, role: actor.role, orgId: actor.orgId, ...metadata });
const getOr404 = async (id, includeObject = false, lang = 'vi') => { const row = await repository.find(id, includeObject); if (!row) { throw new Api404Error(t('satellite_not_found', lang)); } return row; };
const changedOrError = async (value, id, lang) => { if (value) { return value; } if (!await repository.find(id)) { throw new Api404Error(t('satellite_not_found', lang)); } throw new Api409Error(t('satellite_optimistic_conflict', lang), ['OPTIMISTIC_LOCK_CONFLICT']); };
const publicRow = ({ object_key: _objectKey, file_object_id: _fileObjectId, created_by: _createdBy, updated_by: _updatedBy, deleted_at: _deletedAt, ...row }) => row;
const signedRow = async (row, expireSeconds) => ({ ...publicRow(row), ...(await minioService.getPresignedDownloadUrl({ objectKey: row.object_key, category: 'raster', expireSeconds })) });

const list = (filter) => repository.list(filter);
const get = (id, lang) => getOr404(id, false, lang);
const compare = async (beforeId, afterId, lang) => {
    const [before, after] = await Promise.all([getOr404(beforeId, true, lang), getOr404(afterId, true, lang)]);
    if (before.coverage_key !== after.coverage_key) { throw new Api422Error(t('satellite_coverage_mismatch', lang), ['SATELLITE_COVERAGE_MISMATCH']); }
    if (new Date(before.acquired_at).getTime() >= new Date(after.acquired_at).getTime()) { throw new Api422Error(t('satellite_time_order_invalid', lang), ['SATELLITE_TIME_ORDER_INVALID']); }
    return { before: await signedRow(before, 60), after: await signedRow(after, 60) };
};
const download = async (id, expireSeconds, actor) => { requirePermission(actor, 'download'); const row = await getOr404(id, true, actor.lang); const result = await signedRow(row, expireSeconds); audit('satellite_download_url_created', actor, { satelliteImageId: id }); return result; };
const create = async (input, actor) => {
    requirePermission(actor, 'create');
    try { const row = await repository.create(input, actor.id); if (!row) { throw new Api422Error(t('satellite_invalid_file', actor.lang), ['INVALID_RASTER_FILE']); } audit('satellite_created', actor, { satelliteImageId: row.id }); return publicRow(row); }
    catch (error) { if (error.code === '23505') { throw new Api409Error(t('satellite_conflict', actor.lang), ['SATELLITE_CONFLICT']); } throw error; }
};
const categorize = async (id, input, actor) => { requirePermission(actor, 'categorize'); const changed = await changedOrError(await repository.categorize(id, input.thematicGroup, input.expectedUpdatedAt, actor.id), id, actor.lang); audit('satellite_categorized', actor, { satelliteImageId: id, thematicGroup: input.thematicGroup }); return publicRow(changed); };
const remove = async (id, expectedUpdatedAt, actor) => { requirePermission(actor, 'delete'); const changed = await changedOrError(await repository.remove(id, expectedUpdatedAt), id, actor.lang); audit('satellite_deleted', actor, { satelliteImageId: id }); return changed; };
const listAdmin = (filter, actor) => { requirePermission(actor, 'read'); return repository.list(filter); };
module.exports = { list, get, compare, download, create, categorize, remove, listAdmin };