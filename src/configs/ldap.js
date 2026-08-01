const fs = require('fs');
const { Client } = require('ldapts');

const ENABLED = () => process.env.LDAP_ENABLED === 'true';
const ATTRIBUTE_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const DEFAULT_ATTRIBUTES = {
    login: 'sAMAccountName',
    id: 'objectGUID',
    email: 'mail',
    name: 'displayName',
};

const readSecretFile = (envName) => {
    const file = process.env[envName];
    if (!file) {throw new Error(`${envName} is required when LDAP_ENABLED=true`);}
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!value) {throw new Error(`${envName} is empty`);}
    return value;
};

const getConfig = () => {
    if (!ENABLED()) {return null;}

    const url = process.env.LDAP_URL;
    if (!url?.startsWith('ldaps://')) {
        throw new Error('LDAP_URL must use ldaps:// when LDAP_ENABLED=true');
    }
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'ldaps:' || parsedUrl.username || parsedUrl.password
        || (parsedUrl.pathname && parsedUrl.pathname !== '/') || parsedUrl.search || parsedUrl.hash) {
        throw new Error('LDAP_URL must contain only ldaps://host[:port]');
    }

    const required = ['LDAP_BASE_DN', 'LDAP_BIND_DN'];
    for (const name of required) {
        if (!process.env[name]?.trim()) {throw new Error(`${name} is required when LDAP_ENABLED=true`);}
    }

    const attributes = {
        login: process.env.LDAP_LOGIN_ATTRIBUTE || DEFAULT_ATTRIBUTES.login,
        id: process.env.LDAP_ID_ATTRIBUTE || DEFAULT_ATTRIBUTES.id,
        email: process.env.LDAP_EMAIL_ATTRIBUTE || DEFAULT_ATTRIBUTES.email,
        name: process.env.LDAP_NAME_ATTRIBUTE || DEFAULT_ATTRIBUTES.name,
    };
    for (const attribute of Object.values(attributes)) {
        if (!ATTRIBUTE_PATTERN.test(attribute)) {throw new Error(`Invalid LDAP attribute name: ${attribute}`);}
    }

    return {
        url,
        baseDN: process.env.LDAP_BASE_DN.trim(),
        bindDN: process.env.LDAP_BIND_DN.trim(),
        bindPassword: readSecretFile('LDAP_BIND_PASSWORD_FILE'),
        ca: readSecretFile('LDAP_CA_FILE'),
        attributes,
        connectTimeout: parseInt(process.env.LDAP_CONNECT_TIMEOUT_MS, 10) || 5000,
        timeout: parseInt(process.env.LDAP_OPERATION_TIMEOUT_MS, 10) || 5000,
    };
};

const createClient = (config = getConfig()) => {
    if (!config) {throw new Error('LDAP is disabled');}
    return new Client({
        url: config.url,
        connectTimeout: config.connectTimeout,
        timeout: config.timeout,
        strictDN: true,
        tlsOptions: {
            ca: [config.ca],
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true,
        },
    });
};

module.exports = { isEnabled: ENABLED, getConfig, createClient };
