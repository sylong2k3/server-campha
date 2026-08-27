const { createUserSchema } = require('../user.validator');
const cms = require('../cms.validator');
const flood = require('../flood.validator');
const layer = require('../layer.validator');
const remote = require('../remote-sensing.validator');

describe('Admin payloads against real Server Joi validators', () => {
    test('User create payload uses server field names and primitive types', () => {
        const { error, value } = createUserSchema.validate({
            email: 'admin-contract@example.com', password: 'Secret123!', fullName: 'Contract User',
            phone: '', roleCode: 'citizen',
        });
        expect(error).toBeUndefined();
        expect(typeof value.password).toBe('string');
    });

    test('News create contract rejects legacy Admin-only fields', () => {
        const { error } = cms.newsCreateSchema.validate({
            title: 'Contract news', content: 'Contract content', is_published: false,
        }, { allowUnknown: false });
        expect(error).toBeDefined();
    });

    test('Document create requires numeric fileObjectId', () => {
        expect(cms.documentCreateSchema.validate({ title: 'Contract document', documentCode: 'DOC-1', issuingAgency: 'Agency', fileObjectId: 'file' }).error).toBeDefined();
        expect(cms.documentCreateSchema.validate({ title: 'Contract document', documentCode: 'DOC-1', issuingAgency: 'Agency', fileObjectId: 10 }).error).toBeUndefined();
    });

    test('Scenario create documents Joi numeric coercion and strict type behavior', () => {
        const converted = flood.createScenarioSchema.validate({ code: 'scenario_1', nameVi: 'Scenario', layerCode: 'layer_1', minRainfall: '10' });
        expect(converted.error).toBeUndefined();
        expect(converted.value.minRainfall).toBe(10);
        expect(flood.createScenarioSchema.validate({ code: 'scenario_1', nameVi: 'Scenario', layerCode: 'layer_1', minRainfall: '10' }, { convert: false }).error).toBeDefined();
    });

    test('GeoTIFF publish documents Joi numeric coercion and strict type behavior', () => {
        const converted = remote.publishSchema.validate({ code: 'raster_1', nameVi: 'Raster', category: 'flood', srid: '4326' });
        expect(converted.error).toBeUndefined();
        expect(converted.value.srid).toBe(4326);
        expect(remote.publishSchema.validate({ code: 'raster_1', nameVi: 'Raster', category: 'flood', srid: '4326' }, { convert: false }).error).toBeDefined();
    });
});
