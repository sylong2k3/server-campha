'use strict';

/**
 * Script: upload-flood-styles.js
 *
 * Upload tất cả SLD styles cho flood domain lên GeoServer.
 * Chạy một lần lúc setup hoặc khi SLD thay đổi:
 *
 *   node scripts/ops/upload-flood-styles.js
 *
 * Nếu style đã tồn tại → bỏ qua (idempotent).
 * Nếu muốn cập nhật → xoá trên GeoServer trước hoặc chạy --force.
 *
 * Style được load từ src/geo/styles/ — mỗi file <styleName>.sld ánh xạ
 * 1-1 với tên style trên GeoServer workspace.
 */

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../../src/configs/env');
loadEnv();

const geoserver = require('../../src/utils/geoserver.client');

const STYLES_DIR = path.join(__dirname, '../../src/geo/styles');

// Danh sách style cần upload. Thêm entry khi có module mới.
const FLOOD_STYLES = [
    // M2 HAND scenario
    'hand_scenario',
    'hand_depth',
    // M3 Rain risk
    'rain_risk_score',
    'rain_risk_class',
    // M1 Event flood
    'flood_main',
    'flood_shallow',
    // M6 Forecast
    'forecast_flood_mask',
    'forecast_flood_depth',
    'forecast_flood_class',
];

const FORCE = process.argv.includes('--force');

async function uploadOneStyle(styleName) {
    const sldPath = path.join(STYLES_DIR, `${styleName}.sld`);
    if (!fs.existsSync(sldPath)) {
        console.warn(`  [SKIP] ${styleName}.sld không tồn tại tại ${sldPath}`);
        return { styleName, status: 'skipped_no_file' };
    }
    const sldXml = fs.readFileSync(sldPath, 'utf8');
    if (FORCE) {
        try {
            await geoserver.deleteStyle(styleName);
            console.log(`  [DEL]  ${styleName} đã xoá (--force)`);
        } catch {
            /* không tồn tại → bỏ qua */
        }
    }
    try {
        await geoserver.uploadStyle(styleName, sldXml);
        console.log(`  [OK]   ${styleName} đã upload`);
        return { styleName, status: 'uploaded' };
    } catch (err) {
        if (/already exists/i.test(`${err.message} ${err.responseBody || ''}`)) {
            console.log(`  [SKIP] ${styleName} đã tồn tại trên GeoServer`);
            return { styleName, status: 'already_exists' };
        }
        console.error(`  [ERR]  ${styleName}: ${err.message}`);
        return { styleName, status: 'error', error: err.message };
    }
}

async function main() {
    console.log('\n=== Upload Flood SLD Styles → GeoServer ===');
    console.log(`Styles dir: ${STYLES_DIR}`);
    console.log(`Force mode: ${FORCE}`);
    console.log(`Styles    : ${FLOOD_STYLES.length} entries\n`);

    const results = [];
    for (const styleName of FLOOD_STYLES) {
        const result = await uploadOneStyle(styleName);
        results.push(result);
    }

    const uploaded = results.filter((r) => r.status === 'uploaded').length;
    const skipped = results.filter((r) => r.status === 'already_exists').length;
    const noFile = results.filter((r) => r.status === 'skipped_no_file').length;
    const errors = results.filter((r) => r.status === 'error').length;

    console.log(`\n=== Kết quả ===`);
    console.log(`  Đã upload  : ${uploaded}`);
    console.log(`  Đã tồn tại : ${skipped}`);
    console.log(`  Thiếu file : ${noFile}`);
    console.log(`  Lỗi        : ${errors}`);

    if (errors > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
