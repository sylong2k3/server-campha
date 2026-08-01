jest.mock('../../configs/ldap');
jest.mock('../../repositories/ldap.repository');

const { InvalidCredentialsError } = require('ldapts');
const ldapConfig = require('../../configs/ldap');
const ldapRepository = require('../../repositories/ldap.repository');
const ldapService = require('../ldap.service');

const config = {
    url: 'ldaps://dc01.campha.local:636',
    baseDN: 'DC=campha,DC=local',
    bindDN: 'svc@campha.local',
    bindPassword: 'service-secret',
    ca: 'CA',
    connectTimeout: 1000,
    timeout: 1000,
    attributes: { login: 'sAMAccountName', id: 'objectGUID', email: 'mail', name: 'displayName' },
};

const entry = {
    dn: 'CN=Staff,OU=Users,DC=campha,DC=local',
    sAMAccountName: 'staff',
    objectGUID: Buffer.from('00112233', 'hex'),
    mail: 'staff@campha.gov.vn',
    displayName: 'Staff',
    userAccountControl: '512',
    accountExpires: '0',
};

const makeClient = ({ entries = [entry], bindError } = {}) => ({
    bind: jest.fn().mockImplementation(async () => {if (bindError) {throw bindError;}}),
    search: jest.fn().mockResolvedValue({ searchEntries: entries }),
    unbind: jest.fn().mockResolvedValue(),
});

describe('LDAP authentication service', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        ldapConfig.getConfig.mockReturnValue(config);
        ldapRepository.findByExternalId.mockResolvedValue({ id: 7, ldap_is_active: true });
    });

    test('search dùng filter object, bind service và luôn unbind', async () => {
        const client = makeClient();
        ldapConfig.createClient.mockReturnValue(client);
        const result = await ldapService.prepareLogin('staff');
        const options = client.search.mock.calls[0][1];
        expect(typeof options.filter).toBe('object');
        expect(options.filter.filters).toHaveLength(2);
        expect(options.filter.filters[1].value).toBe('staff');
        expect(client.bind).toHaveBeenCalledWith(config.bindDN, config.bindPassword);
        expect(client.unbind).toHaveBeenCalled();
        expect(result.directoryUser.externalId).toBe('00112233');
    });

    test('payload LDAP injection bị từ chối trước search', async () => {
        await expect(ldapService.prepareLogin('staff*)(objectClass=*)'))
            .rejects.toBeInstanceOf(ldapService.LdapAuthenticationError);
        expect(ldapConfig.createClient).not.toHaveBeenCalled();
    });

    test('0 hoặc nhiều entry fail closed', async () => {
        ldapConfig.createClient.mockReturnValueOnce(makeClient({ entries: [] }));
        await expect(ldapService.prepareLogin('staff'))
            .rejects.toBeInstanceOf(ldapService.LdapAuthenticationError);

        ldapConfig.createClient.mockReturnValueOnce(makeClient({ entries: [entry, { ...entry }] }));
        await expect(ldapService.prepareLogin('staff'))
            .rejects.toBeInstanceOf(ldapService.LdapAuthenticationError);
    });

    test('disabled AD account bị từ chối', async () => {
        ldapConfig.createClient.mockReturnValue(makeClient({
            entries: [{ ...entry, userAccountControl: '514' }],
        }));
        await expect(ldapService.prepareLogin('staff'))
            .rejects.toBeInstanceOf(ldapService.LdapAuthenticationError);
    });

    test('user bind phân biệt invalid credential và directory outage, luôn unbind', async () => {
        const invalid = makeClient({ bindError: new InvalidCredentialsError() });
        ldapConfig.createClient.mockReturnValueOnce(invalid);
        await expect(ldapService.verifyPassword(entry.dn, 'wrong'))
            .rejects.toBeInstanceOf(ldapService.LdapAuthenticationError);
        expect(invalid.unbind).toHaveBeenCalled();

        const down = makeClient({ bindError: new Error('ECONNREFUSED') });
        ldapConfig.createClient.mockReturnValueOnce(down);
        await expect(ldapService.verifyPassword(entry.dn, 'secret'))
            .rejects.toBeInstanceOf(ldapService.LdapUnavailableError);
        expect(down.unbind).toHaveBeenCalled();
    });

    test('refresh account không link bỏ qua AD; account disabled trả false', async () => {
        ldapRepository.findByUserId.mockResolvedValueOnce(null);
        await expect(ldapService.verifyLinkedAccountActive(7)).resolves.toBe(true);

        ldapRepository.findByUserId.mockResolvedValueOnce({ external_id: '00112233' });
        ldapConfig.createClient.mockReturnValue(makeClient({ entries: [] }));
        await expect(ldapService.verifyLinkedAccountActive(7)).resolves.toBe(false);
    });
});
