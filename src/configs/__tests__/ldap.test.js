const ldapConfig = require('../ldap');

jest.mock('fs');
jest.mock('ldapts', () => ({ Client: jest.fn() }));
const fs = require('fs');
const { Client } = require('ldapts');

const ORIGINAL_ENV = process.env;

describe('LDAP configuration security', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        process.env = {
            ...ORIGINAL_ENV,
            LDAP_ENABLED: 'true',
            LDAP_URL: 'ldaps://dc01.campha.local:636',
            LDAP_BASE_DN: 'DC=campha,DC=local',
            LDAP_BIND_DN: 'svc_ldap@campha.local',
            LDAP_BIND_PASSWORD_FILE: 'C:/secrets/ldap-password',
            LDAP_CA_FILE: 'C:/certs/ad-ca.pem',
        };
        fs.readFileSync.mockImplementation((file) => file.includes('password') ? 'bind-secret\n' : 'CA PEM\n');
    });

    afterAll(() => {process.env = ORIGINAL_ENV;});

    test('từ chối cleartext ldap://', () => {
        process.env.LDAP_URL = 'ldap://dc01.campha.local:389';
        expect(() => ldapConfig.getConfig()).toThrow('ldaps://');
    });

    test('bắt buộc CA và bind secret file', () => {
        delete process.env.LDAP_CA_FILE;
        expect(() => ldapConfig.getConfig()).toThrow('LDAP_CA_FILE');
    });

    test('client luôn verify certificate với TLS >= 1.2', () => {
        const config = ldapConfig.getConfig();
        ldapConfig.createClient(config);
        expect(Client).toHaveBeenCalledWith(expect.objectContaining({
            tlsOptions: expect.objectContaining({
                minVersion: 'TLSv1.2',
                rejectUnauthorized: true,
            }),
        }));
    });
});
