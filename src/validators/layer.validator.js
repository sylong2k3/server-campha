'use strict';

const Joi = require('joi');

const layerCode = Joi.string().pattern(/^[a-z][a-z0-9_]{2,58}$/).required();
const fileObjectId = Joi.number().integer().positive().required();
const srid = Joi.number().integer().positive().max(999999).required();
const columnName = Joi.string().pattern(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/).required();
const commonImport = {
    fileObjectId,
    code: layerCode,
    nameVi: Joi.string().trim().min(2).max(200).required(),
    category: Joi.string().trim().min(1).max(50).required(),
    targetSrid: Joi.number().integer().positive().max(999999).default(4326),
    isPublic: Joi.boolean().default(false),
};

const shapefileImportSchema = Joi.object({
    ...commonImport,
    sourceEncoding: Joi.string().valid('UTF-8', 'CP1258', 'WINDOWS-1252').optional(),
    topologyProfile: Joi.string().valid('basic', 'administrative_boundary').default('basic'),
});

const excelImportSchema = Joi.object({
    ...commonImport,
    sheetName: Joi.string().trim().min(1).max(120).required(),
    xColumn: columnName,
    yColumn: columnName.invalid(Joi.ref('xColumn')),
    sourceSrid: srid,
});

const jobIdParamsSchema = Joi.object({ jobId: Joi.number().integer().positive().required() });
const layerIdParamsSchema = Joi.object({ layerId: Joi.number().integer().positive().required() });
const paginationSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().valid(10, 20, 50, 100).default(20),
});
const listLayersSchema = paginationSchema.keys({
    q: Joi.string().trim().max(200).allow('').optional(),
    category: Joi.string().trim().max(50).optional(),
    geometryType: Joi.string().valid('POINT','MULTIPOINT','LINESTRING','MULTILINESTRING','POLYGON','MULTIPOLYGON','RASTER').optional(),
    isPublic: Joi.boolean().optional(),
    sortBy: Joi.string().valid('created_at','updated_at','name_vi','code','category').default('updated_at'),
    sortOrder: Joi.string().uppercase().valid('ASC','DESC').default('DESC'),
});

const layerUpdateSchema = Joi.object({
    expectedUpdatedAt: Joi.date().iso().required(),
    nameVi: Joi.string().trim().min(2).max(200),
    category: Joi.string().trim().min(1).max(50).allow(null),
    styleName: Joi.string().pattern(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/).allow(null),
    minZoom: Joi.number().integer().min(0).max(24).allow(null),
    maxZoom: Joi.number().integer().min(0).max(24).allow(null),
    legendConfig: Joi.object().unknown(true),
    metadata: Joi.object().unknown(true),
    isPublic: Joi.boolean(),
}).or('nameVi','category','styleName','minZoom','maxZoom','legendConfig','metadata','isPublic');

const permissionItem = Joi.object({
    roleCode: Joi.string().valid('system_admin','ubnd_tp','so_tnmt','so_xd','citizen').required(),
    canView: Joi.boolean().required(),
    canExport: Joi.boolean().required(),
    canEdit: Joi.boolean().required(),
    canDelete: Joi.boolean().required(),
});
const permissionsSchema = Joi.object({
    permissions: Joi.array().items(permissionItem).max(5).unique('roleCode').required(),
});
const deleteLayerSchema = Joi.object({ expectedUpdatedAt: Joi.date().iso().required() });

module.exports = {
    shapefileImportSchema, excelImportSchema, jobIdParamsSchema, layerIdParamsSchema,
    paginationSchema, listLayersSchema, layerUpdateSchema, permissionsSchema, deleteLayerSchema,
};
