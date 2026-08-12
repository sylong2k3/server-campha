'use strict';

function buildLandChangeProducts(
    ee,
    { oldContext, newContext, miningMask, frequencyPercent, terrain, hand, config, aoi },
) {
    const wasWater = oldContext.water.max(oldContext.floodedVeg).eq(1);
    const pondToBuilt = wasWater
        .and(newContext.built.eq(1))
        .and(miningMask.not())
        .selfMask()
        .rename('pond_to_built')
        .clip(aoi);
    const relativeElevation = terrain.elevation.subtract(
        terrain.elevation.focal_mean(config.localDepressionRadiusM, 'circle', 'meters'),
    );
    const localDepression = relativeElevation.lte(config.localDepressionDepthM);
    const drainageSensitive = frequencyPercent
        .gte(config.frequencyAlertPercent)
        .or(localDepression)
        .or(hand.hand.lte(5).unmask(0))
        .rename('drainage_sensitive')
        .clip(aoi);
    const encroachmentAlert = pondToBuilt
        .updateMask(drainageSensitive)
        .selfMask()
        .rename('encroachment_alert')
        .clip(aoi);
    return { pondToBuilt, drainageSensitive, encroachmentAlert };
}

module.exports = { buildLandChangeProducts };
