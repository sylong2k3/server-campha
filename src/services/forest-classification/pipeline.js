'use strict';

/**
 * Hybrid Sentinel-2 + Landsat land-cover pipeline tailored for Cam Pha.
 *
 * Primary source: Sentinel-2 SR (full 8-band + red-edge → high accuracy).
 * Fallback source: Landsat 8/9 SR (6 common bands, no red-edge) used to fill
 * pixels masked by cloud/shadow in S2. Classification rules branch on whether
 * a pixel has S2 red-edge data; Landsat-only pixels use NBR-based proxies that
 * maintain accuracy for the forest/crop distinction without red-edge.
 *
 * Band name convention (common across both sources after masking):
 *   blue, green, red, nir, swir1, swir2  ← available from both S2 and Landsat
 *   redEdge1, redEdge2                   ← S2-only; masked in Landsat-filled pixels
 */

const { ee } = require('../../configs/gge');
const { Api400Error } = require('../../core/error.response');

const LANDSAT_8_ID = 'LANDSAT/LC08/C02/T1_L2';
const LANDSAT_9_ID = 'LANDSAT/LC09/C02/T1_L2';

const CLASS_DEFINITIONS = Object.freeze([
    { value: 0, label: 'Mặt nước', nameEn: 'Surface water', color: '#0886FB' },
    { value: 1, label: 'Rừng LRTX có độ che phủ thưa', nameEn: 'Sparse evergreen broadleaf forest', color: '#036403' },
    { value: 2, label: 'Dân cư đô thị', nameEn: 'Urban / built-up', color: '#FA9497' },
    { value: 3, label: 'Đất trống khô', nameEn: 'Dry bare land', color: '#FDFE98' },
    { value: 4, label: 'Bãi khai thác than', nameEn: 'Coal mining area', color: '#8C5C07' },
    { value: 5, label: 'Cây bụi', nameEn: 'Shrubland', color: '#318A07' },
    { value: 6, label: 'Đất trống trảng cỏ', nameEn: 'Grassland / sparse vegetation', color: '#CFFC15' },
    { value: 7, label: 'Đất nông nghiệp', nameEn: 'Agricultural land', color: '#FBC695' },
]);

const CLASSIFIED_VIZ = Object.freeze({
    min: 0,
    max: 7,
    palette: CLASS_DEFINITIONS.map(({ color }) => color),
});

// Class-id groupings for the two aggregated indicators Cẩm Phả reports on the
// dashboard (forest coverage and mining footprint). See
// docs/FOREST_CLASSIFICATION_TAXONOMY.md §3.
const FOREST_CLASS_IDS = Object.freeze([1]); // rừng LRTX
const MINE_CLASS_IDS = Object.freeze([4]); // bãi khai thác than

const roundHa = (value) => Number(Number(value || 0).toFixed(2));
const roundPercent = (value) => Number(Number(value || 0).toFixed(2));

/**
 * Build the class-level legend the FE consumes for the dashboard palette,
 * legend widget and KPI breakdown. Contract shared with the client:
 *   [{ classId, nameVi, nameEn, color, ha, percent }]
 */
const buildLegend = (areaByClass = {}, totalHa = 0) =>
    CLASS_DEFINITIONS.map(({ value, label, nameEn, color }) => {
        const ha = roundHa(areaByClass[String(value)] || 0);
        const percent = totalHa > 0 ? roundPercent((ha / totalHa) * 100) : 0;
        return { classId: value, nameVi: label, nameEn, color, ha, percent };
    });

/**
 * Aggregated indicators the dashboard renders as top-level KPI cards:
 * forestHa/mineHa and their percent share of the total classified area.
 */
const summariseCoverage = (areaByClass = {}, totalHa = 0) => {
    const sumOf = (ids) =>
        ids.reduce((total, classId) => total + Number(areaByClass[String(classId)] || 0), 0);
    const forestHa = roundHa(sumOf(FOREST_CLASS_IDS));
    const mineHa = roundHa(sumOf(MINE_CLASS_IDS));
    return {
        forestHa,
        forestPercent: totalHa > 0 ? roundPercent((forestHa / totalHa) * 100) : 0,
        mineHa,
        minePercent: totalHa > 0 ? roundPercent((mineHa / totalHa) * 100) : 0,
    };
};

// S2 mask: renames to common band names so S2 and Landsat composites share the
// same band namespace. redEdge1/redEdge2 are S2-exclusive — they remain masked
// in pixels covered only by Landsat.
const maskSentinel2 = (image) => {
    const scl = image.select('SCL');
    const clearMask = scl
        .neq(3)
        .and(scl.neq(8))
        .and(scl.neq(9))
        .and(scl.neq(10))
        .and(scl.neq(11));
    return image
        .updateMask(clearMask)
        .select(
            ['B2', 'B3', 'B4', 'B5', 'B6', 'B8', 'B11', 'B12'],
            ['blue', 'green', 'red', 'redEdge1', 'redEdge2', 'nir', 'swir1', 'swir2'],
        )
        .multiply(0.0001)
        .copyProperties(image, ['system:time_start']);
};

// Landsat 8/9 Collection-2 SR mask using QA_PIXEL bit flags. Returns only the
// 6 bands that have Sentinel-2 equivalents; red-edge bands are absent.
const maskLandsat = (image) => {
    const qa = image.select('QA_PIXEL');
    const clearMask = qa
        .bitwiseAnd(1 << 0)
        .eq(0)
        .and(qa.bitwiseAnd(1 << 1).eq(0))
        .and(qa.bitwiseAnd(1 << 3).eq(0))
        .and(qa.bitwiseAnd(1 << 4).eq(0))
        .and(qa.bitwiseAnd(1 << 5).eq(0));
    return image
        .updateMask(clearMask)
        .select(
            ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'],
            ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'],
        )
        .multiply(0.0000275)
        .add(-0.2)
        .clamp(0, 1)
        .copyProperties(image, ['system:time_start']);
};

const addDerivedBands = (image) => {
    const blue = image.select('blue');
    const green = image.select('green');
    const red = image.select('red');
    const redEdge1 = image.select('redEdge1');
    const redEdge2 = image.select('redEdge2');
    const nir = image.select('nir');
    const swir1 = image.select('swir1');
    const swir2 = image.select('swir2');
    const safeDivide = (numerator, denominator, name) =>
        numerator.divide(denominator.add(1e-9)).rename(name);

    const ndvi = safeDivide(nir.subtract(red), nir.add(red), 'NDVI');
    const mndwi = safeDivide(green.subtract(swir1), green.add(swir1), 'MNDWI');
    const ndbi = safeDivide(swir1.subtract(nir), swir1.add(nir), 'NDBI');
    const mbi = safeDivide(swir1.subtract(swir2), swir1.add(swir2), 'MBI');
    const evi = image
        .expression('2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1)', {
            nir,
            red,
            blue,
        })
        .rename('EVI');
    const ndviRedEdge = safeDivide(redEdge2.subtract(redEdge1), redEdge2.add(redEdge1), 'NDVIre');
    const bsi = safeDivide(swir1.add(red).subtract(nir.add(blue)), swir1.add(red).add(nir).add(blue), 'BSI');
    const cmr = safeDivide(swir1, swir2, 'CMR');
    const ior = safeDivide(red, blue, 'IOR');
    const nbr = safeDivide(nir.subtract(swir2), nir.add(swir2), 'NBR');
    const ndwi = safeDivide(green.subtract(nir), green.add(nir), 'NDWI');
    const cmri = ndvi.subtract(ndwi).rename('CMRI');
    const awei = image
        .expression('4 * (green - swir1) - (0.25 * nir + 2.75 * swir2)', {
            green,
            swir1,
            nir,
            swir2,
        })
        .rename('AWEI');
    const savi = image
        .expression('1.5 * (nir - red) / (nir + red + 0.5)', { nir, red })
        .rename('SAVI');

    return image.addBands([
        ndvi,
        mndwi,
        ndbi,
        mbi,
        evi,
        ndviRedEdge,
        bsi,
        cmr,
        ior,
        nbr,
        ndwi,
        cmri,
        awei,
        savi,
    ]);
};

const buildSentinelCollection = (params, region) =>
    ee
        .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
        .filterBounds(region)
        .filterDate(params.startDate, params.endDate)
        .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', params.cloudCover))
        .map(maskSentinel2);

const buildSentinelComposite = (params, region) =>
    buildSentinelCollection(params, region).median().clip(region);

const buildLandsatCollection = (params, region) =>
    ee
        .ImageCollection(LANDSAT_8_ID)
        .filterBounds(region)
        .filterDate(params.startDate, params.endDate)
        .map(maskLandsat)
        .merge(
            ee
                .ImageCollection(LANDSAT_9_ID)
                .filterBounds(region)
                .filterDate(params.startDate, params.endDate)
                .map(maskLandsat),
        );

// Builds a pixel-level hybrid composite:
//   • Common bands (blue/green/red/nir/swir1/swir2): S2 where cloud-free, Landsat fill elsewhere.
//   • Red-edge bands (redEdge1/redEdge2): S2-only, remain masked in Landsat-only pixels.
// Callers can detect S2 coverage via composite.select('redEdge1').mask().
const buildHybridComposite = (params, region) => {
    const s2 = buildSentinelCollection(params, region).median().clip(region);
    const landsat = buildLandsatCollection(params, region).median().clip(region);
    const commonBands = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'];
    const hybridCommon = s2.select(commonBands).unmask(landsat.select(commonBands));
    return hybridCommon.addBands(s2.select(['redEdge1', 'redEdge2']));
};

const loadAuxiliaryData = (region, params) => {
    const year = Number(String(params.endDate).slice(0, 4));
    const analysisYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
    const sentinel1 = ee
        .ImageCollection('COPERNICUS/S1_GRD')
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filterBounds(region)
        .filterDate(`${analysisYear}-01-01`, `${analysisYear + 1}-01-01`)
        .select(['VV', 'VH'])
        .median()
        .clip(region);

    // ESA WorldCover v200 provides both mangrove (class 95) and bare-ground
    // (class 60). Mirrors services/flood/common/water-masks.js and
    // services/flood/common/mining-mask.js so both domains derive these masks
    // from the same first-party ESA asset. The previous community GMW and
    // GLAD mining assets (projects/sat-io/open-datasets/{GMW/v3,GLAD/glad_global_mining_30m})
    // both went 404 within the community catalog.
    const worldCover = ee
        .ImageCollection('ESA/WorldCover/v200')
        .first()
        .select('Map')
        .clip(region);
    const dem = ee.Image('USGS/SRTMGL1_003').select('elevation').clip(region);
    // Mining proxy: WorldCover bare (60) intersected with terrain indicators
    // (steep slope OR elevated pits). Downstream `coalMine` clause already
    // filters by low NDVI/NIR so extra spectral gates are redundant.
    const slopeDeg = ee.Terrain.slope(dem);
    const miningProxy = worldCover
        .eq(60)
        .and(slopeDeg.gt(3).or(dem.gt(80)))
        .rename('mining_proxy');
    return {
        jrcWater: ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').clip(region),
        dem,
        sarVhVv: sentinel1.select('VH').subtract(sentinel1.select('VV')).rename('SAR_VH_VV'),
        gmw: worldCover.eq(95).rename('mangrove'),
        gladMining: miningProxy,
        hansen: ee.Image('UMD/hansen/global_forest_change_2023_v1_11')
            .select('treecover2000')
            .clip(region),
    };
};

const classifyLandCover = (composite, auxiliary, region) => {
    const ndvi = composite.select('NDVI');
    const mndwi = composite.select('MNDWI');
    const ndbi = composite.select('NDBI');
    const mbi = composite.select('MBI');
    const evi = composite.select('EVI');
    const savi = composite.select('SAVI');
    const bsi = composite.select('BSI');
    const cmr = composite.select('CMR');
    const ior = composite.select('IOR');
    const nbr = composite.select('NBR');
    const cmri = composite.select('CMRI');
    const awei = composite.select('AWEI');
    const ndviRedEdge = composite.select('NDVIre');
    const nir = composite.select('nir');
    const swir1 = composite.select('swir1');
    const { jrcWater, dem, sarVhVv, gmw, gladMining, hansen } = auxiliary;
    const slope = ee.Terrain.slope(dem);

    // 1 where pixel came from Sentinel-2 (red-edge available), 0 for Landsat-only fill.
    const hasS2 = composite.select('redEdge1').mask();

    const water = mndwi.gt(0.2).or(awei.gt(0)).or(jrcWater.gt(70)).and(ndvi.lt(0.15));
    const tidal = jrcWater
        .gte(10)
        .and(jrcWater.lt(70))
        .or(cmri.gt(0.05).and(ndvi.gte(0.1)).and(ndvi.lt(0.65)))
        .or(gmw.gt(0))
        .and(dem.lt(15))
        .and(water.not());
    const coalMine = nir
        .lt(0.12)
        .and(swir1.lt(0.15))
        .and(ndvi.lt(0.08))
        .and(mndwi.lt(0.08))
        .and(nbr.lt(-0.05))
        .or(gladMining.gt(0).and(ndvi.lt(0.15)).and(nir.lt(0.18)));
    const mineDump = ndvi
        .lt(0.15)
        .and(bsi.gt(0.05))
        .and(cmr.gt(1.15))
        .and(ior.gt(1.5))
        .and(swir1.gt(0.12))
        .and(mndwi.lt(0.08))
        .and(coalMine.not());
    const infrastructure = ndbi
        .gt(0.06)
        .and(ndvi.lt(0.15))
        .and(swir1.gt(0.18))
        .and(mndwi.lt(0.02))
        .and(coalMine.not())
        .and(mineDump.not());
    const residential = ndbi
        .gte(-0.02)
        .and(ndbi.lt(0.06))
        .and(ndvi.gte(0.05))
        .and(ndvi.lt(0.35))
        .and(mbi.lt(0.25))
        .and(mndwi.lt(0.05))
        .and(infrastructure.not());
    const barren = ndvi
        .lt(0.18)
        .and(bsi.gt(-0.05))
        .and(ior.lt(1.5))
        .and(cmr.lt(1.15))
        .and(mndwi.lt(0.12))
        .and(ndbi.lt(0.06))
        .and(coalMine.not())
        .and(mineDump.not())
        .and(infrastructure.not())
        .and(residential.not());

    // Forest rules branch on red-edge availability:
    //   S2 pixels  → NDVIre separates natural (≥0.22) from planted (<0.22) canopy.
    //   Landsat fill → NBR used as proxy; higher NDVI/EVI thresholds compensate for
    //                  the missing spectral dimension (conservative to avoid over-mapping).
    const naturalForestS2 = ndvi
        .gte(0.6)
        .and(evi.gte(0.32))
        .and(ndviRedEdge.gte(0.22))
        .and(sarVhVv.gte(-7))
        .and(hansen.gte(40).or(dem.gte(100)));
    const naturalForestL = ndvi
        .gte(0.65)
        .and(evi.gte(0.35))
        .and(nbr.gte(0.3))
        .and(sarVhVv.gte(-7))
        .and(hansen.gte(40).or(dem.gte(100)));
    const naturalForest = hasS2.and(naturalForestS2).or(hasS2.not().and(naturalForestL));

    const plantedForestS2 = ndvi
        .gte(0.45)
        .and(evi.gte(0.2))
        .and(ndviRedEdge.lt(0.22))
        .and(sarVhVv.lt(-7))
        .and(mndwi.lt(0.05));
    // NBR [0.2, 0.35): moderate canopy closure typical of plantation, below dense natural forest.
    const plantedForestL = ndvi
        .gte(0.45)
        .and(evi.gte(0.2))
        .and(nbr.gte(0.2))
        .and(nbr.lt(0.35))
        .and(sarVhVv.lt(-7))
        .and(mndwi.lt(0.05));
    const plantedForest = hasS2
        .and(plantedForestS2)
        .or(hasS2.not().and(plantedForestL))
        .and(naturalForest.not());

    const shrubGrass = ndvi
        .gte(0.18)
        .and(ndvi.lt(0.45))
        .and(evi.lt(0.22))
        .and(mndwi.lt(0.1))
        .and(naturalForest.not())
        .and(plantedForest.not());

    const perennialCropsS2 = ndvi
        .gte(0.35)
        .and(ndvi.lt(0.6))
        .and(evi.gte(0.15))
        .and(evi.lt(0.32))
        .and(ndviRedEdge.lt(0.2))
        .and(slope.lt(25))
        .and(dem.lt(200));
    // Without NDVIre, use low NBR (open-canopy orchards/gardens) as proxy.
    const perennialCropsL = ndvi
        .gte(0.35)
        .and(ndvi.lt(0.6))
        .and(evi.gte(0.15))
        .and(evi.lt(0.32))
        .and(nbr.lt(0.25))
        .and(slope.lt(25))
        .and(dem.lt(200));
    const perennialCrops = hasS2
        .and(perennialCropsS2)
        .or(hasS2.not().and(perennialCropsL))
        .and(naturalForest.not())
        .and(plantedForest.not());

    const annualCrops = ndvi
        .gte(0.18)
        .and(ndvi.lt(0.55))
        .and(savi.gte(0.08))
        .and(savi.lt(0.4))
        .and(slope.lt(8))
        .and(dem.lt(80))
        .and(mndwi.lt(0.25))
        .and(naturalForest.not())
        .and(plantedForest.not())
        .and(perennialCrops.not())
        .and(shrubGrass.not());

    // 8-class output: 0=Mặt nước, 1=Rừng LRTX, 2=Dân cư đô thị, 3=Đất trống khô,
    // 4=Bãi khai thác than, 5=Cây bụi, 6=Đất trống trảng cỏ, 7=Đất nông nghiệp
    // Default background: 6 (đất trống trảng cỏ / sparse grass)
    return ee
        .Image(6)
        .where(perennialCrops, 7)
        .where(annualCrops, 7)
        .where(shrubGrass.and(ndvi.gte(0.3)), 5)
        .where(plantedForest, 1)
        .where(naturalForest, 1)
        .where(barren, 3)
        .where(residential, 2)
        .where(infrastructure, 2)
        .where(mineDump, 4)
        .where(coalMine, 4)
        .where(tidal, 0)
        .where(water, 0)
        .updateMask(composite.select('blue').mask())
        .rename('class')
        .byte()
        .clip(region);
};

const computeAreaStats = async (classified, region, evaluate) => {
    const result = await evaluate(
        ee.Image.pixelArea()
            .divide(10000)
            .rename('areaHa')
            .addBands(classified.rename('class'))
            .reduceRegion({
                reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
                geometry: region,
                scale: 100,
                bestEffort: true,
                maxPixels: 1e13,
                tileScale: 8,
            }),
    );
    const areaByClass = Object.fromEntries(
        (result?.groups || []).map(({ class: classId, sum }) => [
            String(classId),
            Number(Number(sum || 0).toFixed(2)),
        ]),
    );
    const totalHa = Number(
        Object.values(areaByClass)
            .reduce((total, value) => total + value, 0)
            .toFixed(2),
    );
    return { areaByClass, totalHa };
};

const buildForestClassification = async (params, region, { evaluate }) => {
    const s2Collection = buildSentinelCollection(params, region);
    const landsatCollection = buildLandsatCollection(params, region);
    const [s2Count, landsatCount] = await Promise.all([
        evaluate(s2Collection.size()).then(Number),
        evaluate(landsatCollection.size()).then(Number),
    ]);
    const imageCount = (Number.isFinite(s2Count) ? s2Count : 0) + (Number.isFinite(landsatCount) ? landsatCount : 0);
    if (imageCount <= 0) {
        throw new Api400Error(
            'Không tìm thấy ảnh vệ tinh (Sentinel-2 hoặc Landsat) cho kỳ phân loại đã chọn.',
            ['SATELLITE_IMAGE_NOT_FOUND'],
        );
    }
    const opticalComposite = buildHybridComposite(params, region);
    const composite = addDerivedBands(opticalComposite);
    const auxiliary = loadAuxiliaryData(region, params);
    const image = classifyLandCover(composite, auxiliary, region);
    const area = await computeAreaStats(image, region, evaluate);
    return { image, imageCount, s2Count: s2Count || 0, landsatCount: landsatCount || 0, ...area };
};

module.exports = {
    CLASS_DEFINITIONS,
    CLASSIFIED_VIZ,
    FOREST_CLASS_IDS,
    MINE_CLASS_IDS,
    addDerivedBands,
    buildForestClassification,
    buildHybridComposite,
    buildLandsatCollection,
    buildLegend,
    buildSentinelCollection,
    buildSentinelComposite,
    classifyLandCover,
    computeAreaStats,
    loadAuxiliaryData,
    maskLandsat,
    maskSentinel2,
    summariseCoverage,
};
