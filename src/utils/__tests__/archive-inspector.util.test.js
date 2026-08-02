'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { inspectShapefileZip } = require('../archive-inspector.util');

const zipTool = process.env.GDAL_OGR2OGR_PATH;
const maybeTest = zipTool && fs.existsSync(zipTool) ? test : test.skip;
let tempDir;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-zip-test-'));
});
afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

const createDataset = (name = 'boundary') => {
    const geojson = path.join(tempDir, `${name}.geojson`);
    fs.writeFileSync(
        geojson,
        JSON.stringify({
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: { name: 'A' },
                    geometry: {
                        type: 'Polygon',
                        coordinates: [
                            [
                                [107, 21],
                                [107.1, 21],
                                [107.1, 21.1],
                                [107, 21.1],
                                [107, 21],
                            ],
                        ],
                    },
                },
            ],
        }),
    );
    execFileSync(
        zipTool,
        ['-f', 'ESRI Shapefile', tempDir, geojson, '-nln', name, '-a_srs', 'EPSG:4326'],
        {
            env: {
                ...process.env,
                PROJ_DATA: process.env.PROJ_DATA_PATH,
                GDAL_DATA: process.env.GDAL_DATA_PATH,
            },
        },
    );
};

const powershellZip = (zip, files) => {
    const list = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(',');
    execFileSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path @(${list}) -DestinationPath '${zip.replaceAll("'", "''")}' -Force`,
    ]);
};

maybeTest('accepts exactly one complete shapefile dataset', () => {
    createDataset();
    const zip = path.join(tempDir, 'valid.zip');
    powershellZip(
        zip,
        ['boundary.shp', 'boundary.dbf', 'boundary.shx', 'boundary.prj'].map((name) =>
            path.join(tempDir, name),
        ),
    );
    expect(inspectShapefileZip(zip)).toMatchObject({
        entryCount: 4,
        shapefilePath: 'boundary.shp',
    });
});

maybeTest('rejects a missing mandatory sidecar', () => {
    createDataset();
    const zip = path.join(tempDir, 'missing.zip');
    powershellZip(
        zip,
        ['boundary.shp', 'boundary.dbf', 'boundary.shx'].map((name) => path.join(tempDir, name)),
    );
    expect(() => inspectShapefileZip(zip)).toThrow('đúng một bộ');
});

maybeTest('rejects multiple shapefile datasets', () => {
    createDataset('a');
    createDataset('b');
    const zip = path.join(tempDir, 'multiple.zip');
    powershellZip(
        zip,
        ['a.shp', 'a.dbf', 'a.shx', 'a.prj', 'b.shp', 'b.dbf', 'b.shx', 'b.prj'].map((name) =>
            path.join(tempDir, name),
        ),
    );
    expect(() => inspectShapefileZip(zip)).toThrow('đúng một bộ');
});

maybeTest('rejects nested archives', () => {
    createDataset();
    fs.writeFileSync(path.join(tempDir, 'nested.zip'), 'x');
    const zip = path.join(tempDir, 'nested-container.zip');
    powershellZip(
        zip,
        ['boundary.shp', 'boundary.dbf', 'boundary.shx', 'boundary.prj', 'nested.zip'].map((name) =>
            path.join(tempDir, name),
        ),
    );
    expect(() => inspectShapefileZip(zip)).toThrow('archive lồng nhau');
});

maybeTest('rejects excessive compression ratio', () => {
    createDataset();
    const zipPath = path.join(tempDir, 'ratio.zip');
    powershellZip(
        zipPath,
        ['boundary.shp', 'boundary.dbf', 'boundary.shx', 'boundary.prj'].map((name) =>
            path.join(tempDir, name),
        ),
    );
    expect(() => inspectShapefileZip(zipPath, { maxCompressionRatio: 0.5 })).toThrow(/Tỷ lệ nén/);
});

maybeTest('rejects central/local filename mismatch', () => {
    createDataset();
    const zipPath = path.join(tempDir, 'bad-local.zip');
    powershellZip(
        zipPath,
        ['boundary.shp', 'boundary.dbf', 'boundary.shx', 'boundary.prj'].map((name) =>
            path.join(tempDir, name),
        ),
    );
    const buffer = fs.readFileSync(zipPath);
    const nameLength = buffer.readUInt16LE(26);
    expect(nameLength).toBeGreaterThan(0);
    buffer[30] ^= 0x01;
    fs.writeFileSync(zipPath, buffer);
    expect(() => inspectShapefileZip(zipPath)).toThrow(/không khớp central directory/);
});
