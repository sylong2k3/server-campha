'use strict';

/**
 * Deterministic Sentinel-2 land-cover pipeline tailored for Cam Pha.
 *
 * This is intentionally separate from the generic satellite builders: it needs
 * red-edge/SWIR bands and regional auxiliary datasets which RGB and NDVI do not.
 * It implements the supplied 12-class rule set and clips every output to cp_rg.
 */

const { ee } = require('../../configs/gge');
const { Api400Error } = require('../../core/error.response');

const CLASS_DEFINITIONS = Object.freeze([
    { value: 0, label: 'Nước mặt', nameEn: 'Surface water', color: '#1A73E8' },
    { value: 1, label: 'Rừng tự nhiên', nameEn: 'Natural forest', color: '#2D7B2E' },
    { value: 2, label: 'Rừng trồng', nameEn: 'Planted forest', color: '#85C946' },
    { value: 3, label: 'Cây bụi / trảng cỏ', nameEn: 'Shrub / grassland', color: '#BFD760' },
    { value: 4, label: 'Cây hàng năm', nameEn: 'Annual crop', color: '#F5E642' },
    { value: 5, label: 'Cây lâu năm', nameEn: 'Perennial crop', color: '#F9A825' },
    { value: 6, label: 'Khu dân cư', nameEn: 'Residential', color: '#E91E63' },
    { value: 7, label: 'Công trình - hạ tầng', nameEn: 'Infrastructure', color: '#B71C1C' },
    { value: 8, label: 'Đất trống', nameEn: 'Bare ground', color: '#D7CCC8' },
    { value: 9, label: 'Khai trường mỏ', nameEn: 'Open-pit mine', color: '#000000' },
    { value: 10, label: 'Bãi thải mỏ', nameEn: 'Mine waste dump', color: '#795548' },
    { value: 11, label: 'Đất ngập nước / ven biển', nameEn: 'Wetlands / coastal', color: '#00BCD4' },
]);

const CLASSIFIED_VIZ = Object.freeze({
    min: 0,
    max: 11,
    palette: CLASS_DEFINITIONS.map(({ color }) => color),
});

// Class-id groupings for the two aggregated indicators Cẩm Phả reports on the
// dashboard (forest coverage and mining footprint). See
// docs/FOREST_CLASSIFICATION_TAXONOMY.md §3.
const FOREST_CLASS_IDS = Object.freeze([1, 2]); // natural + planted forest
const MINE_CLASS_IDS = Object.freeze([9, 10]); // pit + waste dump

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
        .select(['B2', 'B3', 'B4', 'B5', 'B6', 'B8', 'B11', 'B12'])
        .multiply(0.0001)
        .copyProperties(image, ['system:time_start']);
};

const addDerivedBands = (image) => {
    const blue = image.select('B2');
    const green = image.select('B3');
    const red = image.select('B4');
    const redEdge1 = image.select('B5');
    const redEdge2 = image.select('B6');
    const nir = image.select('B8');
    const swir1 = image.select('B11');
    const swir2 = image.select('B12');
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
    const nir = composite.select('B8');
    const swir1 = composite.select('B11');
    const { jrcWater, dem, sarVhVv, gmw, gladMining, hansen } = auxiliary;
    const slope = ee.Terrain.slope(dem);

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
    const naturalForest = ndvi
        .gte(0.6)
        .and(evi.gte(0.32))
        .and(ndviRedEdge.gte(0.22))
        .and(sarVhVv.gte(-7))
        .and(hansen.gte(40).or(dem.gte(100)));
    const plantedForest = ndvi
        .gte(0.45)
        .and(evi.gte(0.2))
        .and(ndviRedEdge.lt(0.22))
        .and(sarVhVv.lt(-7))
        .and(mndwi.lt(0.05))
        .and(naturalForest.not());
    const shrubGrass = ndvi
        .gte(0.18)
        .and(ndvi.lt(0.45))
        .and(evi.lt(0.22))
        .and(mndwi.lt(0.1))
        .and(naturalForest.not())
        .and(plantedForest.not());
    const perennialCrops = ndvi
        .gte(0.35)
        .and(ndvi.lt(0.6))
        .and(evi.gte(0.15))
        .and(evi.lt(0.32))
        .and(ndviRedEdge.lt(0.2))
        .and(slope.lt(25))
        .and(dem.lt(200))
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

    return ee
        .Image(3)
        .where(perennialCrops, 5)
        .where(annualCrops, 4)
        .where(shrubGrass, 3)
        .where(plantedForest, 2)
        .where(naturalForest, 1)
        .where(barren, 8)
        .where(residential, 6)
        .where(infrastructure, 7)
        .where(mineDump, 10)
        .where(coalMine, 9)
        .where(tidal, 11)
        .where(water, 0)
        .updateMask(composite.select('B2').mask())
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
    const source = buildSentinelCollection(params, region);
    const imageCount = Number(await evaluate(source.size()));
    if (!Number.isFinite(imageCount) || imageCount <= 0) {
        throw new Api400Error('Không tìm thấy ảnh Sentinel-2 cho kỳ phân loại đã chọn.', [
            'SATELLITE_IMAGE_NOT_FOUND',
        ]);
    }
    const opticalComposite = source.median().clip(region);
    const composite = addDerivedBands(opticalComposite);
    const auxiliary = loadAuxiliaryData(region, params);
    const image = classifyLandCover(composite, auxiliary, region);
    const area = await computeAreaStats(image, region, evaluate);
    return { image, imageCount, ...area };
};

module.exports = {
    CLASS_DEFINITIONS,
    CLASSIFIED_VIZ,
    FOREST_CLASS_IDS,
    MINE_CLASS_IDS,
    addDerivedBands,
    buildForestClassification,
    buildLegend,
    buildSentinelCollection,
    buildSentinelComposite,
    classifyLandCover,
    computeAreaStats,
    loadAuxiliaryData,
    maskSentinel2,
    summariseCoverage,
};
