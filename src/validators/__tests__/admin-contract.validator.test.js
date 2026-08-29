const user = require('../user.validator');
const cms = require('../cms.validator');
const flood = require('../flood.validator');
const layer = require('../layer.validator');
const remote = require('../remote-sensing.validator');
const registry = require('../api-registry.validator');
const auth = require('../auth.validator');
const fieldReport = require('../field-report.validator');

const iso = '2026-01-01T00:00:00.000Z';

function expectValid(schema, payload, options) {
    const result = schema.validate(payload, options);
    expect(result.error).toBeUndefined();
    return result.value;
}

function expectInvalid(schema, payload, options = { allowUnknown: false }) {
    expect(schema.validate(payload, options).error).toBeDefined();
}

describe('Admin payloads against real Server Joi validators', () => {
    test('User create/role/active/reset contracts use Server field names and enums', () => {
        expectValid(user.createUserSchema, {
            email: 'admin-contract@example.com', password: 'Secret123!', fullName: 'Contract User',
            phone: '', roleCode: 'citizen',
        });
        expectValid(user.updateRoleSchema, { roleCode: 'so_tnmt' });
        expectInvalid(user.updateRoleSchema, { roleCode: 'so_nnmt' });
        expectValid(user.setActiveSchema, { isActive: false });
        expectInvalid(user.setActiveSchema, { is_active: false });
        expectValid(user.resetPasswordAdminSchema, { newPassword: 'Secret123!' });
    });

    test('News create/update/delete contract rejects legacy Admin-only fields and enforces locking', () => {
        expectInvalid(cms.newsCreateSchema, {
            title: 'Contract news', content: 'Contract content', is_published: false,
        });
        expectValid(cms.newsCreateSchema, {
            title: 'Contract news', content: 'Contract content', visibility: 'internal', status: 'published',
        });
        expectInvalid(cms.newsUpdateSchema, { title: 'Renamed' });
        expectValid(cms.newsUpdateSchema, { title: 'Renamed', expectedUpdatedAt: iso });
        expectValid(cms.deleteQuerySchema, { expectedUpdatedAt: iso, deleteFiles: false });
    });

    test('Document and PDF Map create/edit contracts require numeric file identities', () => {
        expectInvalid(cms.documentCreateSchema, { title: 'Document', documentCode: 'DOC-1', issuingAgency: 'Agency', fileObjectId: 'file' });
        expectValid(cms.documentCreateSchema, { title: 'Document', documentCode: 'DOC-1', issuingAgency: 'Agency', fileObjectId: 10 });
        expectInvalid(cms.documentUpdateSchema, { title: 'Renamed', fileObjectId: 10, expectedUpdatedAt: iso });
        expectValid(cms.documentUpdateSchema, { title: 'Renamed', expectedUpdatedAt: iso });
        expectValid(cms.pdfMapCreateSchema, { title: 'Map', scaleLabel: '1:10.000', mapYear: 2026, preparingAgency: 'Agency', fileObjectId: 11 });
        expectInvalid(cms.pdfMapCreateSchema, { title: 'Map', scaleLabel: '1:10.000', mapYear: '2026', preparingAgency: 'Agency', fileObjectId: 11 }, { convert: false });
        expectValid(cms.pdfMapUpdateSchema, { title: 'Map 2', expectedUpdatedAt: iso });
    });

    test('Comment moderation only accepts approved/rejected Server states', () => {
        expectValid(cms.commentModerateSchema, { status: 'approved' });
        expectInvalid(cms.commentModerateSchema, { status: 'under_review' });
    });

    test('Layer edit rejects legacy snake_case and enforces camelCase + optimistic locking', () => {
        expectInvalid(layer.layerUpdateSchema, { expectedUpdatedAt: iso, name_vi: 'Legacy', is_public: true });
        expectValid(layer.layerUpdateSchema, { expectedUpdatedAt: iso, nameVi: 'Canonical', categoryName: 'Forest', isPublic: true, isEnableDefault: false });
        expectInvalid(layer.layerUpdateSchema, { nameVi: 'Missing lock' });
        expectValid(layer.deleteLayerSchema, { expectedUpdatedAt: iso });
    });

    test('API Registry create/update/delete/key contracts match canonical service payload', () => {
        expectValid(registry.registryBody, {
            layerId: 7, slug: 'forest-layer', name: 'Forest registry', readFields: ['id', 'geom'],
            writeFields: [], searchFields: ['id'], allowedMethods: ['GET'], defaultSortField: 'id',
        });
        expectInvalid(registry.registryBody, { name: 'Legacy', layer_id: 7, scope: { read: true } });
        expectValid(registry.registryUpdate, { expectedVersion: 3, name: 'Renamed', isActive: false });
        expectInvalid(registry.registryUpdate, { name: 'Missing version' });
        expectValid(registry.deleteQuery, { expectedVersion: 3 });
        expectValid(registry.keyBody, { name: 'Partner key', consumer: 'Partner', scopes: ['features:read'], quotaPerMinute: 60, expiresInHours: 720 });
    });

    test('Feedback review requires lock and rejection reason', () => {
        expectValid(fieldReport.reviewSchema, { status: 'approved', expectedUpdatedAt: iso });
        expectInvalid(fieldReport.reviewSchema, { status: 'rejected', expectedUpdatedAt: iso });
        expectValid(fieldReport.reviewSchema, { status: 'rejected', reason: 'Invalid location', expectedUpdatedAt: iso });
        expectInvalid(fieldReport.reviewSchema, { status: 'pending', expectedUpdatedAt: iso });
    });

    test('Profile and change-password contracts reject UI-only and cross-field-invalid payloads', () => {
        expectValid(auth.updateProfileSchema, { fullName: 'Administrator', phone: '0912345678', avatarUrl: '' });
        expectInvalid(auth.updateProfileSchema, { email: 'immutable@example.com' });
        expectValid(auth.changePasswordSchema, { oldPassword: 'Old@1234', newPassword: 'New@1234' });
        expectInvalid(auth.changePasswordSchema, { oldPassword: 'Same@1234', newPassword: 'Same@1234' });
        expectInvalid(auth.changePasswordSchema, { currentPassword: 'Old@1234', password: 'New@1234' });
    });

    test('Flood submit and legend edits use strict module/config/palette shapes', () => {
        expectValid(flood.submitSchema, { module: 'event', mode: 'product', config: { rainfall: 100 } });
        expectInvalid(flood.submitSchema, { module: 'unknown', config: {} });
        expectValid(flood.updateLegendSchema, { palette: ['ff0000', '00ff00'], min: 0, max: 10 });
        expectInvalid(flood.updateLegendSchema, { palette: ['#ff0000'] });
    });

    test('Scenario create/update documents numeric coercion and strict type behavior', () => {
        const converted = expectValid(flood.createScenarioSchema, { code: 'scenario_1', nameVi: 'Scenario', layerCode: 'layer_1', minRainfall: '10' });
        expect(converted.minRainfall).toBe(10);
        expectInvalid(flood.createScenarioSchema, { code: 'scenario_1', nameVi: 'Scenario', layerCode: 'layer_1', minRainfall: '10' }, { convert: false });
        expectValid(flood.updateScenarioSchema, { nameVi: 'Scenario 2', isActive: false });
        expectInvalid(flood.updateScenarioSchema, { name_vi: 'Legacy' });
    });

    test('Remote image create/publish contracts require numeric file/srid and reject legacy keys', () => {
        expectValid(remote.createSchema, { sceneCode: 'S2-2026', title: 'Sentinel image', platform: 'sentinel-2', coverageKey: 'sentinel_2026', acquiredAt: iso, fileObjectId: 12 });
        expectInvalid(remote.createSchema, { scene_code: 'S2', title: 'Legacy', file: 'x.tif' });
        const converted = expectValid(remote.publishSchema, { code: 'raster_1', nameVi: 'Raster', category: 'flood', srid: '4326' });
        expect(converted.srid).toBe(4326);
        expectInvalid(remote.publishSchema, { code: 'raster_1', nameVi: 'Raster', category: 'flood', srid: '4326' }, { convert: false });
    });
});
