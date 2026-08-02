'use strict';
const { escapeXml, toIso19139Xml } = require('../geographic-metadata.util');
const profile = {
    metadataIdentifier: 'cp.roads',
    language: 'vie',
    characterSet: 'utf8',
    hierarchyLevel: 'dataset',
    dateStamp: '2026-08-02',
    standardVersion: 'TCVN 12687:2019',
    contact: { organizationName: 'Sở TN&MT <Quảng Ninh>', email: 'gis@example.vn', role: 'owner' },
    referenceSystem: { code: 'EPSG:5899', codeSpace: 'EPSG' },
    identification: {
        title: 'Đường & cầu',
        abstract: 'Dữ liệu giao thông Cẩm Phả',
        purpose: 'Quản lý',
        status: 'completed',
        citationDate: '2026-08-02',
        citationDateType: 'creation',
        language: 'vie',
        characterSet: 'utf8',
        topicCategories: ['transportation'],
        keywords: ['giao thông'],
        extent: {
            description: 'Cẩm Phả',
            westBoundLongitude: 107,
            eastBoundLongitude: 108,
            southBoundLatitude: 20,
            northBoundLatitude: 22,
        },
    },
    constraints: {
        accessConstraints: 'restricted',
        useConstraints: 'license',
        otherConstraints: 'Nội bộ',
    },
    dataQuality: { scope: 'dataset', lineage: 'Biên tập và kiểm tra topology' },
    distribution: {
        formatName: 'PostGIS',
        formatVersion: '3',
        onlineResources: [
            { url: 'https://example.vn/a?x=1&y=2', protocol: 'WWW:LINK', name: 'API' },
        ],
    },
};
test('escapes XML special characters', () =>
    expect(escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;'));
test('exports ISO 19139 namespaces and escaped profile', () => {
    const xml = toIso19139Xml({ geometry_type: 'LINESTRING' }, profile);
    expect(xml).toContain('xmlns:gmd="http://www.isotc211.org/2005/gmd"');
    expect(xml).toContain('TCVN 12687:2019 / ISO 19115');
    expect(xml).toContain('Sở TN&amp;MT &lt;Quảng Ninh&gt;');
    expect(xml).toContain('https://example.vn/a?x=1&amp;y=2');
    expect(xml.trim().endsWith('</gmd:MD_Metadata>')).toBe(true);
});
