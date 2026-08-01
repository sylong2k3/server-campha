'use strict';
const ORIGINAL_ENV = process.env;
const load = (env = {}) => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, GEOSERVER_ENABLED: 'true', GEOSERVER_URL: 'https://geo.example/geoserver', GEOSERVER_USER: 'service', GEOSERVER_PASSWORD_FILE: 'password', GEOSERVER_WORKSPACE: 'campha', GEOSERVER_DATASTORE: 'campha_postgis', ...env };
    jest.doMock('fs', () => {
        const actual = jest.requireActual('fs');
        return { ...actual, readFileSync: jest.fn((file, ...args) => file === 'password' ? 'secret' : actual.readFileSync(file, ...args)) };
    });
    return require('../geoserver');
};
describe('GeoServer config', () => {
    beforeEach(() => { process.env = ORIGINAL_ENV; jest.clearAllMocks(); jest.unmock('fs'); });
    test('rejects URL credentials and query', () => {
        expect(() => load({ GEOSERVER_URL: 'https://user:pass@geo.example/geoserver?x=1' }).getConfig()).toThrow('without credentials');
    });
    test('rejects unsafe resource identifiers', () => {
        expect(() => load({ GEOSERVER_WORKSPACE: '../other' }).getConfig()).toThrow('GEOSERVER_WORKSPACE is invalid');
    });
    test('reads password from file', () => {
        expect(load().getConfig()).toMatchObject({ password: 'secret', workspace: 'campha', datastore: 'campha_postgis' });
    });
});