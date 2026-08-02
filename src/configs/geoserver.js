'use strict';

const fs = require('fs');
require('dotenv').config();

const isEnabled = () => process.env.GEOSERVER_ENABLED === 'true';
const RESOURCE_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;

const readSecretFile = (envName) => {
    const file = process.env[envName];
    if (!file) {
        throw new Error(`${envName} is required when GEOSERVER_ENABLED=true`);
    }
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!value) {
        throw new Error(`${envName} is empty`);
    }
    return value;
};

const validateResourceName = (value, label) => {
    if (!RESOURCE_PATTERN.test(value || '')) {
        throw new Error(`${label} is invalid`);
    }
    return value;
};

const getConfig = () => {
    if (!isEnabled()) {
        return null;
    }
    const rawUrl = process.env.GEOSERVER_URL;
    if (!rawUrl) {
        throw new Error('GEOSERVER_URL is required when GEOSERVER_ENABLED=true');
    }
    const parsed = new URL(rawUrl);
    if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
    ) {
        throw new Error(
            'GEOSERVER_URL must be an http(s) server URL without credentials/query/hash',
        );
    }
    const user = process.env.GEOSERVER_USER?.trim();
    if (!user || user.length > 100) {
        throw new Error('GEOSERVER_USER is invalid');
    }
    return {
        url: rawUrl.replace(/\/+$/, ''),
        user,
        password: readSecretFile('GEOSERVER_PASSWORD_FILE'),
        workspace: validateResourceName(
            process.env.GEOSERVER_WORKSPACE || 'campha',
            'GEOSERVER_WORKSPACE',
        ),
        namespaceUri: process.env.GEOSERVER_NAMESPACE_URI || 'https://gis.campha.gov.vn/campha',
        datastore: validateResourceName(
            process.env.GEOSERVER_DATASTORE || 'campha_postgis',
            'GEOSERVER_DATASTORE',
        ),
        timeoutMs: Number(process.env.GEOSERVER_TIMEOUT_MS || 15000),
    };
};

const assertGeoserverConfigured = () => {
    const config = getConfig();
    if (!config) {
        throw new Error('GeoServer is disabled');
    }
    if (
        !Number.isInteger(config.timeoutMs) ||
        config.timeoutMs < 1000 ||
        config.timeoutMs > 120000
    ) {
        throw new Error('GEOSERVER_TIMEOUT_MS is invalid');
    }
    return config;
};

module.exports = {
    isEnabled,
    getConfig,
    assertGeoserverConfigured,
    validateResourceName,
    RESOURCE_PATTERN,
};
