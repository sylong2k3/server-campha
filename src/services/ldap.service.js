const {
    AndFilter,
    EqualityFilter,
    InvalidCredentialsError,
} = require('ldapts');
const ldapConfig = require('../configs/ldap');
const ldapRepository = require('../repositories/ldap.repository');

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,254}$/;
const AD_ACCOUNT_DISABLED = 0x0002;
const WINDOWS_EPOCH_OFFSET_MS = 11644473600000n;

class LdapAuthenticationError extends Error {
    constructor() {
        super('LDAP authentication failed');
        this.name = 'LdapAuthenticationError';
    }
}

class LdapUnavailableError extends Error {
    constructor() {
        super('LDAP directory unavailable');
        this.name = 'LdapUnavailableError';
    }
}

const firstValue = (value) => Array.isArray(value) ? value[0] : value;

const externalIdHex = (entry, attribute) => {
    const value = firstValue(entry[attribute]);
    if (Buffer.isBuffer(value)) {return value.toString('hex');}
    return value ? Buffer.from(String(value), 'binary').toString('hex') : null;
};

const isExpired = (entry) => {
    const raw = firstValue(entry.accountExpires);
    if (!raw || raw === '0' || raw === '9223372036854775807') {return false;}
    try {
        const expiresMs = BigInt(raw) / 10000n - WINDOWS_EPOCH_OFFSET_MS;
        return expiresMs <= BigInt(Date.now());
    } catch {
        return true;
    }
};

const toDirectoryUser = (entry, attributes) => {
    const externalId = externalIdHex(entry, attributes.id);
    const loginName = firstValue(entry[attributes.login]);
    const userAccountControl = Number(firstValue(entry.userAccountControl) || 0);
    if (!externalId || !loginName || (userAccountControl & AD_ACCOUNT_DISABLED) !== 0 || isExpired(entry)) {
        throw new LdapAuthenticationError();
    }
    return {
        distinguishedName: entry.dn,
        externalId,
        loginName: String(loginName),
        email: firstValue(entry[attributes.email]) || null,
        fullName: firstValue(entry[attributes.name]) || String(loginName),
    };
};

const safeUnbind = async (client) => {
    try {await client.unbind();} catch { /* connection may already be closed */ }
};

const withServiceClient = async (operation) => {
    const config = ldapConfig.getConfig();
    if (!config) {throw new LdapUnavailableError();}
    const client = ldapConfig.createClient(config);
    try {
        await client.bind(config.bindDN, config.bindPassword);
        return await operation(client, config);
    } catch (error) {
        if (error instanceof LdapAuthenticationError) {throw error;}
        throw new LdapUnavailableError();
    } finally {
        await safeUnbind(client);
    }
};

const searchOne = async (filterFactory) => withServiceClient(async (client, config) => {
    const { attributes } = config;
    const { searchEntries } = await client.search(config.baseDN, {
        scope: 'sub',
        filter: new AndFilter({
            filters: [
                new EqualityFilter({ attribute: 'objectClass', value: 'user' }),
                filterFactory(attributes),
            ],
        }),
        attributes: [
            attributes.login,
            attributes.id,
            attributes.email,
            attributes.name,
            'userAccountControl',
            'accountExpires',
        ],
        explicitBufferAttributes: [attributes.id],
        sizeLimit: 2,
        timeLimit: Math.max(1, Math.ceil(config.timeout / 1000)),
    });
    if (searchEntries.length !== 1) {throw new LdapAuthenticationError();}
    return toDirectoryUser(searchEntries[0], attributes);
});

const findByLogin = async (username) => {
    if (!USERNAME_PATTERN.test(username)) {throw new LdapAuthenticationError();}
    return searchOne((attributes) => new EqualityFilter({
        attribute: attributes.login,
        value: username,
    }));
};

const findByExternalId = (externalId) => searchOne((attributes) => new EqualityFilter({
    attribute: attributes.id,
    value: Buffer.from(externalId, 'hex'),
}));

const prepareLogin = async (username) => {
    const directoryUser = await findByLogin(username);
    const user = await ldapRepository.findByExternalId(directoryUser.externalId);
    if (!user || !user.ldap_is_active) {throw new LdapAuthenticationError();}
    return { user, directoryUser };
};

const verifyPassword = async (distinguishedName, password) => {
    const config = ldapConfig.getConfig();
    if (!config) {throw new LdapUnavailableError();}
    const client = ldapConfig.createClient(config);
    try {
        await client.bind(distinguishedName, password);
    } catch (error) {
        if (error instanceof InvalidCredentialsError) {throw new LdapAuthenticationError();}
        throw new LdapUnavailableError();
    } finally {
        await safeUnbind(client);
    }
};

const verifyLinkedAccountActive = async (userId) => {
    const identity = await ldapRepository.findByUserId(userId);
    if (!identity) {return true;}
    try {
        const directoryUser = await findByExternalId(identity.external_id);
        await ldapRepository.touchVerified(userId, directoryUser);
        return true;
    } catch (error) {
        if (error instanceof LdapAuthenticationError) {return false;}
        throw error;
    }
};

const findForProvision = findByLogin;

module.exports = {
    LdapAuthenticationError,
    LdapUnavailableError,
    findForProvision,
    prepareLogin,
    verifyPassword,
    verifyLinkedAccountActive,
};
