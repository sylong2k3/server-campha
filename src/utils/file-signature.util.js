'use strict';

const SIGNATURES = Object.freeze({
    '.jpg': [{ offset: 0, bytes: 'ffd8ff', mime: 'image/jpeg' }],
    '.jpeg': [{ offset: 0, bytes: 'ffd8ff', mime: 'image/jpeg' }],
    '.png': [{ offset: 0, bytes: '89504e470d0a1a0a', mime: 'image/png' }],
    '.webp': [
        {
            offset: 0,
            bytes: '52494646',
            secondaryOffset: 8,
            secondaryAscii: 'WEBP',
            mime: 'image/webp',
        },
    ],
    '.pdf': [{ offset: 0, ascii: '%PDF-', mime: 'application/pdf' }],
    '.zip': [{ offset: 0, bytes: '504b0304', mime: 'application/zip' }],
    '.docx': [
        {
            offset: 0,
            bytes: '504b0304',
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
    ],
    '.xlsx': [
        {
            offset: 0,
            bytes: '504b0304',
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
    ],
    '.pptx': [
        {
            offset: 0,
            bytes: '504b0304',
            mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        },
    ],
    '.doc': [{ offset: 0, bytes: 'd0cf11e0a1b11ae1', mime: 'application/msword' }],
    '.xls': [{ offset: 0, bytes: 'd0cf11e0a1b11ae1', mime: 'application/vnd.ms-excel' }],
    '.ppt': [{ offset: 0, bytes: 'd0cf11e0a1b11ae1', mime: 'application/vnd.ms-powerpoint' }],
    '.tif': [
        { offset: 0, bytes: '49492a00', mime: 'image/tiff' },
        { offset: 0, bytes: '4d4d002a', mime: 'image/tiff' },
        { offset: 0, bytes: '49492b00', mime: 'image/tiff' },
        { offset: 0, bytes: '4d4d002b', mime: 'image/tiff' },
    ],
    '.tiff': [
        { offset: 0, bytes: '49492a00', mime: 'image/tiff' },
        { offset: 0, bytes: '4d4d002a', mime: 'image/tiff' },
        { offset: 0, bytes: '49492b00', mime: 'image/tiff' },
        { offset: 0, bytes: '4d4d002b', mime: 'image/tiff' },
    ],
});

const CATEGORY_EXTENSIONS = Object.freeze({
    layers: new Set(['.zip', '.json', '.geojson', '.csv', '.xlsx']),
    raster: new Set(['.tif', '.tiff']),
    documents: new Set([
        '.pdf',
        '.doc',
        '.docx',
        '.xml',
        '.xls',
        '.xlsx',
        '.ppt',
        '.pptx',
        '.txt',
        '.csv',
        '.zip',
    ]),
    'field-photos': new Set(['.png', '.webp']),
});

const textMime = (extension, buffer) => {
    if (buffer.includes(0)) {
        return null;
    }
    const text = buffer.toString('utf8');
    if (text.includes('\uFFFD')) {
        return null;
    }
    if (extension === '.json' || extension === '.geojson') {
        const first = text.trimStart()[0];
        // ponytail: full JSON/schema parsing belongs to the bounded Sprint 3 import worker.
        if (first !== '{' && first !== '[') {
            return null;
        }
        return 'application/geo+json';
    }
    if (extension === '.xml') {
        const trimmed = text.trimStart();
        if (!trimmed.startsWith('<?xml') && !/^<[A-Za-z_]/.test(trimmed)) {
            return null;
        }
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
            return null;
        }
        return 'application/xml';
    }
    return extension === '.csv' ? 'text/csv' : 'text/plain';
};

const detectFileType = ({ originalName, category, head }) => {
    const extension = require('path')
        .extname(originalName || '')
        .toLowerCase();
    const allowed = CATEGORY_EXTENSIONS[category];
    if (!allowed?.has(extension)) {
        return null;
    }
    if (['.txt', '.csv', '.xml', '.json', '.geojson'].includes(extension)) {
        return textMime(extension, head);
    }
    const rules = SIGNATURES[extension] || [];
    const match = rules.find((rule) => {
        const expected = rule.bytes
            ? Buffer.from(rule.bytes, 'hex')
            : Buffer.from(rule.ascii, 'ascii');
        const primary = head.subarray(rule.offset, rule.offset + expected.length).equals(expected);
        if (!primary) {
            return false;
        }
        if (rule.secondaryAscii) {
            const secondary = Buffer.from(rule.secondaryAscii, 'ascii');
            return head
                .subarray(rule.secondaryOffset, rule.secondaryOffset + secondary.length)
                .equals(secondary);
        }
        return true;
    });
    // ponytail: OOXML is verified as a ZIP container only; inspect ZIP entries before Sprint 3 imports.
    return match?.mime || null;
};

module.exports = { CATEGORY_EXTENSIONS, detectFileType };
