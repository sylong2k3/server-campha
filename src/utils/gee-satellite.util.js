'use strict';

/**
 * Shared GEE (Google Earth Engine) satellite utilities.
 *
 * Used by the retained Forest Classification runtime.
 *
 * All functions accept/return EE objects unless noted with "→ JS value".
 */

const fs = require('fs');
const path = require('path');
const { ee } = require('../configs/gge');

// Default timeout for .evaluate() calls (5 minutes).
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GEE_TIMEOUT_MS, 10) || 5 * 60 * 1000;

// Local Cẩm Phả boundary (higher-fidelity than FAO/GAUL).
// Used only as a fallback when the request omits `params.geometry`;
// user-supplied ROIs are always clipped to as-is.
// The Forest scientific pipeline remains frozen; only its operational AOI
// helpers and data sources are scoped explicitly to Cẩm Phả.
const CAMPHA_BOUNDARY_PATH = path.resolve(
    process.env.FC_BOUNDARY_GEOJSON ||
        path.resolve(__dirname, '../../data/CamPha_Boundary.geojson'),
);

// ── GEE async helpers ─────────────────────────────────────────────────────────

/**
 * Promisify ee object.evaluate(callback).
 * Rejects after timeoutMs to prevent hanging forever.
 * → JS value
 */
function eeEval(eeObject, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`GEE evaluate() timeout after ${timeoutMs}ms`)),
            timeoutMs,
        );
        eeObject.evaluate((result, err) => {
            clearTimeout(timer);
            if (err) {
                reject(new Error(String(err)));
            } else {
                resolve(result);
            }
        });
    });
}

/**
 * Promisify ee object.getInfo(callback) without blocking the Node.js event loop.
 * Use this only for small metadata objects such as classifier diagnostics.
 */
function eeGetInfo(eeObject, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`GEE getInfo() timeout after ${timeoutMs}ms`)),
            timeoutMs,
        );
        eeObject.getInfo((result, err) => {
            clearTimeout(timer);
            if (err) {
                reject(new Error(String(err)));
            } else {
                resolve(result);
            }
        });
    });
}

/**
 * Get GEE map tile info for display on Leaflet / MapboxGL.
 * Returns { mapId, token, tileUrl } where tileUrl has {z}/{x}/{y} placeholders.
 *
 * Applies eeImage.visualize(vizParams) client-side (returns an RGB ee.Image),
 * then passes that to ee.data.getMapId. This avoids the SDK trying to CSV-encode
 * numeric arrays/values ("csv.split is not a function") when raw viz params are
 * passed to getMapId.
 * → JS value
 */
function getEeMapId(eeImage, vizParams = {}) {
    // If viz params provided, bake them into an RGB image via ee.Image.visualize().
    const visImage =
        vizParams && Object.keys(vizParams).length > 0 ? eeImage.visualize(vizParams) : eeImage;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('GEE getMapId timeout')),
            DEFAULT_TIMEOUT_MS,
        );
        ee.data.getMapId({ image: visImage }, (mapInfo, err) => {
            clearTimeout(timer);
            if (err) {
                reject(new Error(String(err)));
                return;
            }
            const mapid = mapInfo.mapid || mapInfo.name || '';
            const token = mapInfo.token || '';
            const tileUrl = token
                ? `https://earthengine.googleapis.com/map/${mapid}/{z}/{x}/{y}?token=${token}`
                : `https://earthengine.googleapis.com/v1alpha/${mapid}/tiles/{z}/{x}/{y}`;
            resolve({ mapId: mapid, token, tileUrl });
        });
    });
}

// ── Region helpers ────────────────────────────────────────────────────────────

function getCamPhaRegion() {
    return ee.FeatureCollection([ee.Feature(getCamPhaBoundaryGeometry())]);
}

const CAMPHA_ADMIN_UNITS_PATH = path.resolve(
    process.env.FC_DISTRICTS_GEOJSON || path.resolve(__dirname, '../../data/CamPha_Wards.geojson'),
);

let _cachedDistrictsFC = null;
let _cachedDistrictsSource = null;

/**
 * Đơn vị hành chính Cẩm Phả từ GeoJSON được mount bằng
 * `FC_DISTRICTS_GEOJSON`; schema property cũ vẫn được chấp nhận để giữ tương
 * thích với pipeline khoa học.
 *
 * Fallback FAO/GAUL/2015/level2 (8 huyện cũ, đã lỗi thời) khi file local
 * KHÔNG tồn tại HOẶC parse fail HOẶC không có feature hợp lệ. Fallback in
 * cảnh báo rõ ràng để ops biết.
 *
 * Trả về ee.FeatureCollection dùng cho reduceRegions(). reduceRegions output
 * feature.geometry sẽ ở EPSG:4326 (GEE mặc định) — an toàn để persist PostGIS
 * + tính centroid client-side.
 *
 * Output ee.Feature properties (consumer-facing, KHÔNG đổi tên để tương
 * thích Forest Classification):
 *   - ADM2_CODE  → map từ `ma_huyen` (string), unique — VD "608", "610"
 *   - ADM2_NAME  → map từ `ten_huyen` (fallback `ten`)
 *   - NAME_EN    → luôn null (file không có tên English)
 *   - NAME_VN    → alias của ADM2_NAME
 *   - TYPE_2     → map từ `loai` — VD "Huyện" / "Thành phố"
 *   - source     → nhãn debug (LOCAL_WGS84 hoặc LOCAL_EPSG:XXXX)
 */
function getCamPhaAdministrativeUnits() {
    if (_cachedDistrictsFC) {
        return _cachedDistrictsFC;
    }

    const loadResult = _tryLoadDistrictsFile(CAMPHA_ADMIN_UNITS_PATH);
    if (loadResult) {
        _cachedDistrictsFC = loadResult.fc;
        _cachedDistrictsSource = loadResult.source;
        console.log(`[GEE-SAT] Districts ✓ ${loadResult.count} features (${loadResult.source})`);
        return _cachedDistrictsFC;
    }

    console.warn(
        '[GEE-SAT] Administrative units ⚠ fallback FAO/GAUL/2015/level2 (Cẩm Phả city boundary). Configure FC_DISTRICTS_GEOJSON for the authoritative ward set.',
    );
    _cachedDistrictsFC = ee
        .FeatureCollection('FAO/GAUL/2015/level2')
        .filter(ee.Filter.eq('ADM0_NAME', 'Viet Nam'))
        .filter(ee.Filter.eq('ADM1_NAME', 'Quang Ninh'))
        .filter(ee.Filter.eq('ADM2_NAME', 'Cam Pha'));
    _cachedDistrictsSource = 'FAO_GAUL_2015_LEVEL2';
    return _cachedDistrictsFC;
}

/**
 * Đọc file huyện + build ee.FeatureCollection. Trả về null nếu file lỗi.
 * TÁCH riêng để log rõ từng bước và catch từng loại lỗi.
 */
function _tryLoadDistrictsFile(filePath) {
    if (!fs.existsSync(filePath)) {
        console.warn(`[GEE-SAT] Districts file KHÔNG tồn tại: ${filePath}`);
        return null;
    }
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        console.warn(`[GEE-SAT] Districts đọc file lỗi: ${err.message}`);
        return null;
    }
    let doc;
    try {
        doc = JSON.parse(raw);
    } catch (err) {
        console.warn(`[GEE-SAT] Districts JSON parse lỗi: ${err.message}`);
        return null;
    }
    if (doc?.type !== 'FeatureCollection' || !Array.isArray(doc.features)) {
        console.warn(
            `[GEE-SAT] Districts file không phải GeoJSON FeatureCollection (type=${doc?.type})`,
        );
        return null;
    }

    const featCount = doc.features.length;
    const crsName = doc.crs?.properties?.name;
    const epsg = _parseEpsgCode(crsName);
    const projLbl = epsg ? `EPSG:${epsg}` : null;
    const nonWgs84 = epsg && epsg !== '4326';

    // Build ee.Feature per doc.feature. Ưu tiên schema ranh giới hành chính mới,
    // nhưng vẫn giữ alias GADM cũ để tương thích khi vận hành với file legacy.
    const seenCodes = new Set();
    const eeFeats = [];
    let addedIdx = 0;
    let skippedNoGeom = 0;
    let skippedDup = 0;
    for (const f of doc.features) {
        const g = f?.geometry;
        if (!g || !Array.isArray(g.coordinates) || g.coordinates.length === 0) {
            skippedNoGeom += 1;
            continue;
        }
        const p = f.properties || {};
        // Chấp nhận schema huyện/phường và GAUL/GADM phổ biến để data owner
        // không phải đổi thuộc tính của boundary chính thức.
        const rawName =
            p.ten_phuong ||
            p.ten_xa ||
            p.ten_huyen ||
            p.ten ||
            p.name ||
            p.NAME_VN ||
            p.ADM2_NAME ||
            null;
        const rawCode = p.ma_phuong ?? p.ma_xa ?? p.ma_huyen ?? p.code ?? p.ADM2_CODE ?? null;
        if (!rawName || rawCode === null || rawCode === undefined || rawCode === '') {
            console.warn(
                `[GEE-SAT] Administrative unit skip feature #${addedIdx + 1}: thiếu code/name (properties=${JSON.stringify(p)})`,
            );
            skippedDup += 1;
            continue;
        }
        const name = String(rawName);
        const code = String(rawCode);
        if (seenCodes.has(code)) {
            skippedDup += 1;
            continue;
        }
        seenCodes.add(code);

        const clean = { type: g.type, coordinates: _stripZ(g.coordinates) };
        const eeGeom = nonWgs84 ? ee.Geometry(clean, projLbl, false) : ee.Geometry(clean);
        // Output vẫn giữ tên property GADM (ADM2_CODE/ADM2_NAME/...) để
        // Forest Classification không phải
        // đổi consumer code — chỉ INPUT (đọc file) là đổi sang key tiếng Việt.
        eeFeats.push(
            ee.Feature(eeGeom, {
                ADM2_CODE: code,
                ADM2_NAME: name,
                NAME_EN: null,
                NAME_VN: name,
                TYPE_2: p.loai || p.type || p.TYPE_2 || null,
                source: projLbl ? `LOCAL_${projLbl}` : 'LOCAL_WGS84',
            }),
        );
        addedIdx += 1;
    }
    // Chỉ log 1 dòng tổng kết khi có warning (skippedDup/noGeom > 0) hoặc lỗi
    // (0 features). Trường hợp bình thường không log — log tổng ở caller đã đủ.
    if (skippedDup > 0 || skippedNoGeom > 0) {
        console.log(
            `[GEE-SAT] Districts: ${featCount} raw → ${eeFeats.length} unique (skipped noGeom=${skippedNoGeom}, dup=${skippedDup})`,
        );
    }
    if (eeFeats.length === 0) {
        console.warn('[GEE-SAT] Districts ✗ không tạo được ee.Feature nào từ file.');
        return null;
    }
    return {
        fc: ee.FeatureCollection(eeFeats),
        count: eeFeats.length,
        source: projLbl ? `LOCAL_RANHGIOIHUYEN_${projLbl}` : 'LOCAL_RANHGIOIHUYEN_WGS84',
    };
}

/**
 * Xoá cache districts — dùng khi thay file huyện mà không muốn restart process.
 * Lần gọi tiếp theo sẽ đọc lại file từ đĩa.
 */
function invalidateCamPhaAdministrativeUnits() {
    _cachedDistrictsFC = null;
    _cachedDistrictsSource = null;
    console.log('[GEE-SAT] Districts cache invalidated — next call sẽ đọc lại file.');
}

/**
 * Nguồn thực tế của tập đơn vị hành chính đã cache.
 */
function getCamPhaAdministrativeUnitsSource() {
    return _cachedDistrictsSource;
}

// GeoJSON raw huyện dùng cho district-chunked download (migration 040).
// Trả về mảng `[{ADM2_CODE, ADM2_NAME, geometry, source}]` KHÔNG bọc ee.Geometry
// — caller tự convert qua `ee.Geometry(feature.geometry)` khi cần clip. Đọc
// cùng file với tập đơn vị hành chính, cache riêng để không mất cache khi
// caller invalidate FC.
let _cachedDistrictsGeoJson = null;
function getCamPhaAdministrativeUnitsGeoJson() {
    if (_cachedDistrictsGeoJson) {
        return _cachedDistrictsGeoJson;
    }
    if (!fs.existsSync(CAMPHA_ADMIN_UNITS_PATH)) {
        console.warn(
            `[GEE-SAT] Administrative-unit GeoJSON file KHÔNG tồn tại: ${CAMPHA_ADMIN_UNITS_PATH}`,
        );
        _cachedDistrictsGeoJson = [];
        return _cachedDistrictsGeoJson;
    }
    let doc;
    try {
        doc = JSON.parse(fs.readFileSync(CAMPHA_ADMIN_UNITS_PATH, 'utf8'));
    } catch (err) {
        console.warn(`[GEE-SAT] Districts GeoJSON parse lỗi: ${err.message}`);
        _cachedDistrictsGeoJson = [];
        return _cachedDistrictsGeoJson;
    }
    if (doc?.type !== 'FeatureCollection' || !Array.isArray(doc.features)) {
        _cachedDistrictsGeoJson = [];
        return _cachedDistrictsGeoJson;
    }
    const crsName = doc.crs?.properties?.name;
    const epsg = _parseEpsgCode(crsName);
    const seen = new Set();
    const out = [];
    let idx = 0;
    for (const f of doc.features) {
        const g = f?.geometry;
        if (!g || !Array.isArray(g.coordinates) || g.coordinates.length === 0) {
            continue;
        }
        const p = f.properties || {};
        const rawName =
            p.ten_phuong ||
            p.ten_xa ||
            p.ten_huyen ||
            p.ten ||
            p.name ||
            p.NAME_VN ||
            p.ADM2_NAME ||
            null;
        const rawCode = p.ma_phuong ?? p.ma_xa ?? p.ma_huyen ?? p.code ?? p.ADM2_CODE ?? null;
        if (!rawName || rawCode === null || rawCode === undefined || rawCode === '') {
            console.warn(
                `[GEE-SAT] Administrative-unit GeoJSON skip feature #${idx + 1}: thiếu code/name`,
            );
            continue;
        }
        const name = String(rawName);
        const code = String(rawCode);
        if (seen.has(code)) {
            continue;
        }
        seen.add(code);
        out.push({
            ADM2_CODE: code,
            ADM2_NAME: name,
            NAME_EN: null,
            TYPE_2: p.loai || p.type || p.TYPE_2 || null,
            geometry: { type: g.type, coordinates: _stripZ(g.coordinates) },
            epsg: epsg ? Number(epsg) : 4326,
        });
        idx += 1;
    }
    _cachedDistrictsGeoJson = out;
    console.log(`[GEE-SAT] Districts GeoJSON ✓ ${out.length} huyện đọc từ file (raw).`);
    return _cachedDistrictsGeoJson;
}

// ── Local Cẩm Phả boundary polygon ───────────────────────────────────────────

// Recursively strip Z/M components so ee.Geometry accepts the coords —
// the source file stores [x, y, 0] triplets which GEE rejects.
function _stripZ(coords) {
    if (typeof coords[0] === 'number') {
        return coords.slice(0, 2);
    }
    return coords.map(_stripZ);
}

// Extract the numeric EPSG code from either "EPSG:XXXX" or a CRS URN
// like "urn:ogc:def:crs:EPSG::XXXX".
function _parseEpsgCode(crsName) {
    const m = String(crsName || '').match(/EPSG:*:*(\d+)$/i);
    return m ? m[1] : null;
}

let _cachedBoundaryGeom = null;
let _cachedBoundarySource = null;

/**
 * Load the Cẩm Phả city polygon.
 * Priority:
 *   1. Local GeoJSON from FC_BOUNDARY_GEOJSON
 *   2. FAO/GAUL/2015/level2 — fallback nếu file local vắng mặt
 *      trên production. Kém chi tiết hơn ranh giới thực nhưng đủ cho tính stats.
 *
 * Lazily evaluated + cached singleton.
 */
function getCamPhaBoundaryGeometry() {
    if (_cachedBoundaryGeom) {
        return _cachedBoundaryGeom;
    }

    // Try local file first — preferred.
    if (fs.existsSync(CAMPHA_BOUNDARY_PATH)) {
        try {
            const raw = fs.readFileSync(CAMPHA_BOUNDARY_PATH, 'utf8');
            const doc = JSON.parse(raw);
            const feature =
                doc.type === 'FeatureCollection'
                    ? doc.features?.[0]
                    : doc.type === 'Feature'
                      ? doc
                      : null;
            const geom =
                feature?.geometry ||
                (doc.type === 'Polygon' || doc.type === 'MultiPolygon' ? doc : null);
            if (!geom) {
                throw new Error('Không thấy polygon geometry hợp lệ');
            }

            const crsName = doc.crs?.properties?.name;
            const epsg = _parseEpsgCode(crsName);
            const projLabel = epsg ? `EPSG:${epsg}` : 'EPSG:4326';
            const cleanGeom = {
                type: geom.type,
                coordinates: _stripZ(geom.coordinates),
            };
            _cachedBoundaryGeom =
                epsg && epsg !== '4326'
                    ? ee.Geometry(cleanGeom, projLabel, false)
                    : ee.Geometry(cleanGeom);
            _cachedBoundarySource = `LOCAL_${projLabel}`;
            console.log(
                `[GEE-SAT] ✓ Cẩm Phả polygon: ${_cachedBoundarySource} (${CAMPHA_BOUNDARY_PATH})`,
            );
            return _cachedBoundaryGeom;
        } catch (err) {
            console.warn(
                `[GEE-SAT] Lỗi đọc Cẩm Phả polygon ${CAMPHA_BOUNDARY_PATH}: ${err.message}`,
            );
        }
    } else {
        console.warn(`[GEE-SAT] Cẩm Phả polygon file KHÔNG tồn tại: ${CAMPHA_BOUNDARY_PATH}`);
    }

    // Fallback: FAO/GAUL/2015/level1 (dissolved to province).
    console.warn(
        '[GEE-SAT] ⚠ Fallback boundary: FAO/GAUL/2015/level2 (Cẩm Phả). ' +
            'Configure FC_BOUNDARY_GEOJSON with the authoritative city boundary for production.',
    );
    const faoFC = ee
        .FeatureCollection('FAO/GAUL/2015/level2')
        .filter(ee.Filter.eq('ADM0_NAME', 'Viet Nam'))
        .filter(ee.Filter.eq('ADM1_NAME', 'Quang Ninh'))
        .filter(ee.Filter.eq('ADM2_NAME', 'Cam Pha'));
    _cachedBoundaryGeom = faoFC.geometry();
    _cachedBoundarySource = 'FAO_GAUL_2015_LEVEL2_CAMPHA';
    return _cachedBoundaryGeom;
}

/**
 * Nguồn thực tế của Cẩm Phả boundary đã cache.
 */
function getCamPhaBoundarySource() {
    return _cachedBoundarySource;
}

/**
 * Diagnostic tại startup — kiểm tra file local nào có sẵn để cảnh báo sớm
 * thay vì đợi first API request. Không throw, chỉ log.
 */
function logGeeGeometrySources() {
    console.log('[GEE-SAT] ── Kiểm tra file geometry local ─────────────────');
    const files = [
        ['Cẩm Phả', CAMPHA_BOUNDARY_PATH],
        ['Administrative units', CAMPHA_ADMIN_UNITS_PATH],
    ];
    let allOk = true;
    for (const [label, filePath] of files) {
        const exists = fs.existsSync(filePath);
        const mark = exists ? '✓' : '✗';
        let sizeKb = '';
        if (exists) {
            try {
                sizeKb = ` (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`;
            } catch {
                /* ignore */
            }
        }
        console.log(`[GEE-SAT]  ${mark} ${label}: ${filePath}${sizeKb}`);
        if (!exists) {
            allOk = false;
        }
    }
    if (!allOk) {
        console.log('[GEE-SAT] ⚠ File thiếu — sẽ dùng FAO/GAUL làm fallback.');
        console.log('[GEE-SAT]   Fix: mount FC_BOUNDARY_GEOJSON + FC_DISTRICTS_GEOJSON.');
    }
    console.log('[GEE-SAT] ──────────────────────────────────────────────────');
}

/**
 * Parse a geometry parameter (GeoJSON object or bbox array [minX,minY,maxX,maxY])
 * into an ee.Geometry. Falls back to the configured Cẩm Phả boundary when omitted.
 */
function toEeGeometry(geometry) {
    if (!geometry) {
        return getCamPhaBoundaryGeometry();
    }
    if (Array.isArray(geometry) && geometry.length === 4) {
        const [minX, minY, maxX, maxY] = geometry;
        return ee.Geometry.BBox(minX, minY, maxX, maxY);
    }
    return ee.Geometry(geometry);
}

// ── Image masking & preparation ───────────────────────────────────────────────

/**
 * Landsat Collection 2 Level-2 cloud mask using QA_PIXEL.
 * Removes fill, dilated cloud, cloud, cloud shadow, snow.
 */
function maskLandsatC2(image) {
    const qa = image.select('QA_PIXEL');
    const mask = qa
        .bitwiseAnd(1 << 0)
        .eq(0) // fill
        .and(qa.bitwiseAnd(1 << 1).eq(0)) // dilated cloud
        .and(qa.bitwiseAnd(1 << 3).eq(0)) // cloud
        .and(qa.bitwiseAnd(1 << 4).eq(0)) // cloud shadow
        .and(qa.bitwiseAnd(1 << 5).eq(0)); // snow
    return image.updateMask(mask);
}

/** Prepare Landsat 5/7 C2 L2 optical bands → blue/green/red/nir/swir1/swir2 */
function prepL57(image) {
    return image
        .select(
            ['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7'],
            ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'],
        )
        .multiply(0.0000275)
        .add(-0.2)
        .clamp(0, 1)
        .toFloat()
        .copyProperties(image, ['system:time_start']);
}

/** Prepare Landsat 8/9 C2 L2 optical bands → blue/green/red/nir/swir1/swir2 */
function prepL89(image) {
    return image
        .select(
            ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'],
            ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'],
        )
        .multiply(0.0000275)
        .add(-0.2)
        .clamp(0, 1)
        .toFloat()
        .copyProperties(image, ['system:time_start']);
}

/**
 * Sentinel-2 SR cloud mask using SCL band.
 * Renames bands → blue/green/red/nir/swir1/swir2 (same schema as Landsat prep).
 */
function maskS2(image) {
    const scl = image.select('SCL');
    const mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
    return image
        .select(
            ['B2', 'B3', 'B4', 'B8', 'B11', 'B12'],
            ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'],
        )
        .multiply(0.0001)
        .clamp(0, 1)
        .toFloat()
        .updateMask(mask)
        .copyProperties(image, ['system:time_start']);
}

// ── Composite ─────────────────────────────────────────────────────────────────

/**
 * Build a cloud-free median composite for a given year/month range.
 * Merges Landsat 5/7/8/9 + Sentinel-2 (if year >= 2017).
 * Returns a 6-band image: blue/green/red/nir/swir1/swir2.
 */
function makeComposite(year, startMonth, endMonth, region) {
    const startDate = ee.Date.fromYMD(year, startMonth, 1);
    const endDate = ee.Date.fromYMD(year, endMonth, 1).advance(1, 'month');
    const bounds = region || getCamPhaBoundaryGeometry();

    const l5 = ee
        .ImageCollection('LANDSAT/LT05/C02/T1_L2')
        .filterBounds(bounds)
        .filterDate(startDate, endDate)
        .map(maskLandsatC2)
        .map(prepL57);
    const l7 = ee
        .ImageCollection('LANDSAT/LE07/C02/T1_L2')
        .filterBounds(bounds)
        .filterDate(startDate, endDate)
        .map(maskLandsatC2)
        .map(prepL57);
    const l8 = ee
        .ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterBounds(bounds)
        .filterDate(startDate, endDate)
        .map(maskLandsatC2)
        .map(prepL89);
    const l9 = ee
        .ImageCollection('LANDSAT/LC09/C02/T1_L2')
        .filterBounds(bounds)
        .filterDate(startDate, endDate)
        .map(maskLandsatC2)
        .map(prepL89);

    let collection = l5.merge(l7).merge(l8).merge(l9);

    if (year >= 2017) {
        const s2 = ee
            .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(bounds)
            .filterDate(startDate, endDate)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60))
            .map(maskS2);
        collection = collection.merge(s2);
    }

    const bands = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'];
    const mapped = collection.map((img) =>
        img.select(bands).clamp(0, 1).toFloat().copyProperties(img, ['system:time_start']),
    );

    // Fallback: masked constant image with correct band schema.
    // Prevents "Band pattern 'blue' was applied to an Image with no bands" when
    // the merged collection is empty (e.g. seasonal window in the future).
    const fallback = ee.Image.constant([0.12, 0.1, 0.08, 0.4, 0.2, 0.12])
        .rename(bands)
        .updateMask(ee.Image.constant(0));

    const composite = ee.Image(ee.Algorithms.If(mapped.size().gt(0), mapped.median(), fallback));

    return composite.select(bands).clip(bounds).toFloat();
}

// ── Spectral indices ──────────────────────────────────────────────────────────

/**
 * Compute 8 spectral indices from a 6-band image (blue/green/red/nir/swir1/swir2).
 * All output bands are prefixed with `prefix_` (e.g. 'base_NDVI').
 * If prefix is empty string, no prefix is added.
 */
function addIndices(image, prefix) {
    const p = prefix ? prefix + '_' : '';
    const ndvi = image.normalizedDifference(['nir', 'red']).rename(p + 'NDVI');
    const ndwi = image.normalizedDifference(['green', 'nir']).rename(p + 'NDWI');
    const mndwi = image.normalizedDifference(['green', 'swir1']).rename(p + 'MNDWI');
    const ndmi = image.normalizedDifference(['nir', 'swir1']).rename(p + 'NDMI');
    const ndbi = image.normalizedDifference(['swir1', 'nir']).rename(p + 'NDBI');
    const nbr = image.normalizedDifference(['nir', 'swir2']).rename(p + 'NBR');
    const bsi = image
        .expression('((SWIR + RED) - (NIR + BLUE)) / ((SWIR + RED) + (NIR + BLUE))', {
            SWIR: image.select('swir1'),
            RED: image.select('red'),
            NIR: image.select('nir'),
            BLUE: image.select('blue'),
        })
        .rename(p + 'BSI');
    const evi = image
        .expression('2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
            NIR: image.select('nir'),
            RED: image.select('red'),
            BLUE: image.select('blue'),
        })
        .rename(p + 'EVI');
    return ee.Image.cat([ndvi, ndwi, mndwi, ndmi, ndbi, nbr, bsi, evi]);
}

// ── Collection helpers ────────────────────────────────────────────────────────

/**
 * Return median image, or a masked constant fallback if collection is empty.
 * Generic collection fallback retained for satellite composites.
 */
function medianOrFallback(collection, bands, fallbackValues) {
    const fallback = ee.Image.constant(fallbackValues)
        .rename(bands)
        .updateMask(ee.Image.constant(0));
    return ee.Image(
        ee.Algorithms.If(collection.size().gt(0), collection.select(bands).median(), fallback),
    );
}

// ── DEM helpers ───────────────────────────────────────────────────────────────

/** Return elevation/slope/aspect from SRTM for the given region. */
function getDemBands(region) {
    const dem = ee.Image('USGS/SRTMGL1_003').clip(region || getCamPhaBoundaryGeometry());
    const elevation = dem.rename('elevation');
    const slope = ee.Terrain.slope(dem).rename('slope');
    const aspect = ee.Terrain.aspect(dem).rename('aspect');
    return { elevation, slope, aspect };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Generate a temporary GEE download URL for a satellite image (GeoTIFF).
 * Returns `{ url, filename }` (filename = `${name}_${date}.zip`) hoặc null nếu
 * ảnh quá lớn / GEE reject. Client dùng filename cho `<a download>`.
 *
 * @param {object} eeImage
 * @param {object} region
 * @param {object} [vizParams] — nếu truyền → visualize() trước → GeoTIFF màu (RGB).
 *                              Bỏ trống → giữ nguyên band (ảnh khoa học, có thể đen trắng).
 * @param {object} [opts]
 * @param {string} [opts.name]      — base filename, ví dụ "satellite_rgb". Default 'gee_export'.
 * @param {string} [opts.date]      — YYYY-MM-DD, append vào filename. Default nay UTC.
 * @param {number} [opts.scale]     — pixel scale (m). Default 100.
 * @param {number} [opts.maxPixels] — Default 1e8.
 * @param {number} [opts.timeoutMs] — Default 20s.
 */
async function getEeDownloadUrl(eeImage, region, vizParams = {}, opts = {}) {
    const {
        name = 'gee_export',
        date = todayUtc(),
        scale = 100,
        maxPixels = 1e8,
        timeoutMs = 20_000,
    } = opts;
    try {
        const visImage = Object.keys(vizParams).length > 0 ? eeImage.visualize(vizParams) : eeImage;
        // `name` param của GEE sẽ nằm trong Content-Disposition header của URL trả về,
        // browser dùng khi user Save As. Format: <name>_<YYYYMMDD>.
        const safeName = String(name)
            .replace(/[^a-z0-9_-]/gi, '_')
            .toLowerCase();
        const compactDate = String(date).replace(/-/g, '');
        const fileBase = `${safeName}_${compactDate}`;
        const url = await new Promise((resolve) => {
            const timer = setTimeout(() => {
                console.warn(
                    `[GEE-DOWNLOAD] Timed out after ${timeoutMs}ms (name=${fileBase}, scale=${scale}m).`,
                );
                resolve(null);
            }, timeoutMs);
            visImage.getDownloadURL(
                {
                    name: fileBase,
                    scale,
                    region,
                    fileFormat: 'GeoTIFF',
                    // KHÔNG chia band ra 3 file — trả 1 file GeoTIFF 3-band RGB
                    // duy nhất trong zip. Unzip xong là 1 ảnh màu đủ, không phải
                    // 3 file per-band (red/green/blue) rời rạc.
                    filePerBand: false,
                    maxPixels,
                },
                (u, err) => {
                    clearTimeout(timer);
                    if (err) {
                        console.warn(
                            `[GEE-DOWNLOAD] Failed (name=${fileBase}, scale=${scale}m): ${err.message || err}`,
                        );
                    }
                    resolve(err ? null : u);
                },
            );
        });
        if (!url) {
            return null;
        }
        return { url, filename: `${fileBase}.zip` };
    } catch (e) {
        console.warn(`[GEE-DOWNLOAD] Failed before URL generation: ${e.message || e}`);
        return null;
    }
}

/** Current date as 'YYYY-MM-DD' string (UTC). */
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Format Date or string as 'YYYY-MM-DD'. */
const fmtDate = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().slice(0, 10);
};

module.exports = {
    eeEval,
    eeGetInfo,
    getEeMapId,
    getEeDownloadUrl,
    getCamPhaRegion,
    getCamPhaAdministrativeUnits,
    getCamPhaAdministrativeUnitsGeoJson,
    getCamPhaAdministrativeUnitsSource,
    invalidateCamPhaAdministrativeUnits,
    getCamPhaBoundaryGeometry,
    getCamPhaBoundarySource,
    logGeeGeometrySources,
    toEeGeometry,
    maskLandsatC2,
    prepL57,
    prepL89,
    maskS2,
    makeComposite,
    addIndices,
    medianOrFallback,
    getDemBands,
    todayUtc,
    fmtDate,
};
