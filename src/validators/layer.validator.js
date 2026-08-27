'use strict';

const Joi = require('joi');

const layerCode = Joi.string()
    .pattern(/^[a-z][a-z0-9_]{2,58}$/)
    .required();
const fileObjectId = Joi.number().integer().positive().required();
const srid = Joi.number().integer().positive().max(999999).required();
const columnName = Joi.string()
    .pattern(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/)
    .required();
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
    sourceEncoding: Joi.string()
        .trim()
        .uppercase()
        .valid('UTF-8', 'CP1258', 'WINDOWS-1258', 'TCVN3', 'TCVN-3', 'WINDOWS-1252', 'CP1252')
        .optional(),
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
    search: Joi.string().trim().max(200).allow('').optional(),
    category: Joi.string().trim().max(50).optional(),
    geometryType: Joi.string()
        .valid(
            'POINT',
            'MULTIPOINT',
            'LINESTRING',
            'MULTILINESTRING',
            'POLYGON',
            'MULTIPOLYGON',
            'RASTER',
        )
        .optional(),
    isPublic: Joi.boolean().optional(),
    sortBy: Joi.string()
        .valid('created_at', 'updated_at', 'name_vi', 'code', 'category')
        .default('updated_at'),
    sortOrder: Joi.string().uppercase().valid('ASC', 'DESC').default('DESC'),
});

const metadataContact = Joi.object({
    organizationName: Joi.string().trim().min(2).max(200).required(),
    email: Joi.string().email().max(254).optional(),
    role: Joi.string().valid('custodian', 'owner', 'pointOfContact', 'publisher').required(),
});
const geographicExtent = Joi.object({
    description: Joi.string().trim().max(500).optional(),
    westBoundLongitude: Joi.number().min(106).max(109).required(),
    eastBoundLongitude: Joi.number().min(Joi.ref('westBoundLongitude')).max(109).required(),
    southBoundLatitude: Joi.number().min(19).max(22.5).required(),
    northBoundLatitude: Joi.number().min(Joi.ref('southBoundLatitude')).max(22.5).required(),
    begin: Joi.date().iso().optional(),
    end: Joi.date().iso().min(Joi.ref('begin')).optional(),
});
const geographicMetadataSchema = Joi.object({
    expectedUpdatedAt: Joi.date().iso().required(),
    metadataIdentifier: Joi.string()
        .trim()
        .pattern(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/)
        .required(),
    language: Joi.string().valid('vie', 'eng').default('vie'),
    characterSet: Joi.string().valid('utf8').default('utf8'),
    hierarchyLevel: Joi.string().valid('dataset', 'series').default('dataset'),
    dateStamp: Joi.date().iso().required(),
    standardVersion: Joi.string()
        .trim()
        .max(80)
        .default('TCVN 12687:2019; ISO 19115; ISO 19139:2007'),
    contact: metadataContact.required(),
    referenceSystem: Joi.object({
        code: Joi.string().trim().min(3).max(80).required(),
        codeSpace: Joi.string().trim().min(2).max(120).default('EPSG'),
    }).required(),
    identification: Joi.object({
        title: Joi.string().trim().min(2).max(300).required(),
        abstract: Joi.string().trim().min(10).max(5000).required(),
        purpose: Joi.string().trim().max(2000).optional(),
        status: Joi.string()
            .valid(
                'completed',
                'historicalArchive',
                'onGoing',
                'planned',
                'required',
                'underDevelopment',
            )
            .required(),
        citationDate: Joi.date().iso().required(),
        citationDateType: Joi.string().valid('creation', 'publication', 'revision').required(),
        language: Joi.string().valid('vie', 'eng').default('vie'),
        characterSet: Joi.string().valid('utf8').default('utf8'),
        topicCategories: Joi.array()
            .items(
                Joi.string().valid(
                    'biota',
                    'boundaries',
                    'climatologyMeteorologyAtmosphere',
                    'economy',
                    'elevation',
                    'environment',
                    'geoscientificInformation',
                    'health',
                    'imageryBaseMapsEarthCover',
                    'inlandWaters',
                    'location',
                    'oceans',
                    'planningCadastre',
                    'society',
                    'structure',
                    'transportation',
                    'utilitiesCommunication',
                ),
            )
            .min(1)
            .max(5)
            .unique()
            .required(),
        keywords: Joi.array()
            .items(Joi.string().trim().min(2).max(120))
            .min(1)
            .max(30)
            .unique()
            .required(),
        spatialResolutionMeters: Joi.number().positive().max(1000000).optional(),
        extent: geographicExtent.required(),
    }).required(),
    constraints: Joi.object({
        accessConstraints: Joi.string()
            .valid(
                'copyright',
                'intellectualPropertyRights',
                'license',
                'otherRestrictions',
                'restricted',
                'unrestricted',
            )
            .required(),
        useConstraints: Joi.string()
            .valid(
                'copyright',
                'intellectualPropertyRights',
                'license',
                'otherRestrictions',
                'restricted',
                'unrestricted',
            )
            .required(),
        otherConstraints: Joi.string().trim().max(2000).optional(),
    }).required(),
    dataQuality: Joi.object({
        scope: Joi.string().valid('dataset', 'series').default('dataset'),
        lineage: Joi.string().trim().min(10).max(5000).required(),
        conformanceResult: Joi.string().trim().max(2000).optional(),
    }).required(),
    distribution: Joi.object({
        formatName: Joi.string().trim().min(1).max(100).required(),
        formatVersion: Joi.string().trim().min(1).max(60).required(),
        onlineResources: Joi.array()
            .items(
                Joi.object({
                    url: Joi.string()
                        .uri({ scheme: ['http', 'https'] })
                        .max(1000)
                        .required(),
                    protocol: Joi.string().trim().max(80).required(),
                    name: Joi.string().trim().max(200).optional(),
                    description: Joi.string().trim().max(500).optional(),
                }),
            )
            .max(10)
            .default([]),
    }).required(),
});

const legendColor = Joi.string()
    .trim()
    .pattern(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
    .required();
const legendEntry = Joi.object({
    label: Joi.string().trim().min(1).max(200).required(),
    color: legendColor,
});
const legendConfigSchema = Joi.object({
    entries: Joi.array().items(legendEntry).min(1).max(50).required(),
})
    .allow(null)
    .default(null);

const layerUpdateSchema = Joi.object({
    expectedUpdatedAt: Joi.date().iso().required(),
    nameVi: Joi.string().trim().min(2).max(200),
    category: Joi.string().trim().min(1).max(50).allow(null),
    categoryName: Joi.string().trim().min(2).max(120).allow(null),
    styleName: Joi.string()
        .pattern(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/)
        .allow(null),
    minZoom: Joi.number().integer().min(0).max(24).allow(null),
    maxZoom: Joi.number().integer().min(0).max(24).allow(null),
    legendConfig: legendConfigSchema,
    metadata: Joi.object({ standardProfile: Joi.forbidden() }).unknown(true),
    isPublic: Joi.boolean(),
    isEnableDefault: Joi.boolean(),
}).or(
    'nameVi',
    'category',
    'categoryName',
    'styleName',
    'minZoom',
    'maxZoom',
    'legendConfig',
    'metadata',
    'isPublic',
    'isEnableDefault',
);

const permissionItem = Joi.object({
    roleCode: Joi.string()
        .valid('system_admin', 'ubnd_tp', 'so_tnmt', 'so_xd', 'citizen')
        .required(),
    canView: Joi.boolean().required(),
    canExport: Joi.boolean().required(),
    canEdit: Joi.boolean().required(),
    canDelete: Joi.boolean().required(),
});
const permissionsSchema = Joi.object({
    permissions: Joi.array().items(permissionItem).max(5).unique('roleCode').required(),
});
const deleteLayerSchema = Joi.object({
    expectedUpdatedAt: Joi.date().iso().required(),
    deleteFiles: Joi.boolean().default(false),
});

module.exports = {
    shapefileImportSchema,
    excelImportSchema,
    jobIdParamsSchema,
    layerIdParamsSchema,
    paginationSchema,
    listLayersSchema,
    layerUpdateSchema,
    legendConfigSchema,
    geographicMetadataSchema,
    permissionsSchema,
    deleteLayerSchema,
};
