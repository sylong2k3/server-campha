'use strict';
const validator = require('../layer.validator');
const profile = {
    expectedUpdatedAt: '2026-08-02T00:00:00.000Z',
    metadataIdentifier: 'campha.roads',
    language: 'vie',
    characterSet: 'utf8',
    hierarchyLevel: 'dataset',
    dateStamp: '2026-08-02',
    contact: { organizationName: 'Sở TNMT', role: 'owner' },
    referenceSystem: { code: 'EPSG:5899' },
    identification: {
        title: 'Giao thông',
        abstract: 'Dữ liệu giao thông thành phố Cẩm Phả',
        status: 'completed',
        citationDate: '2026-08-02',
        citationDateType: 'creation',
        topicCategories: ['transportation'],
        keywords: ['giao thông'],
        extent: {
            westBoundLongitude: 107,
            eastBoundLongitude: 108,
            southBoundLatitude: 20,
            northBoundLatitude: 22,
        },
    },
    constraints: { accessConstraints: 'restricted', useConstraints: 'license' },
    dataQuality: { lineage: 'Đã kiểm tra topology và hệ quy chiếu' },
    distribution: { formatName: 'PostGIS', formatVersion: '3' },
};
test('accepts strict geographic profile and rejects invalid bbox', () => {
    expect(validator.geographicMetadataSchema.validate(profile).error).toBeUndefined();
    expect(
        validator.geographicMetadataSchema.validate({
            ...profile,
            identification: {
                ...profile.identification,
                extent: { ...profile.identification.extent, eastBoundLongitude: 106.5 },
            },
        }).error,
    ).toBeTruthy();
});
test('generic layer patch cannot bypass standard metadata endpoint', () => {
    expect(
        validator.layerUpdateSchema.validate({
            expectedUpdatedAt: profile.expectedUpdatedAt,
            metadata: { standardProfile: profile },
        }).error,
    ).toBeTruthy();
});
