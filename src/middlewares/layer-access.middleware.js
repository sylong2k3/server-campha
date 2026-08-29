const db = require('../configs/database');
const { Api400Error, Api401Error, Api403Error, Api404Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');
const { verifyTileTicket } = require('../utils/map-tile-ticket.util');

const ACCESS_COLUMNS = {
    view: 'can_view',
    export: 'can_export',
    edit: 'can_edit',
    delete: 'can_delete',
};

const requireLayerAccess = (access) => {
    const permissionColumn = ACCESS_COLUMNS[access];
    if (!permissionColumn) {
        throw new TypeError(`Unsupported layer access: ${access}`);
    }

    return async (req, res, next) => {
        const layerId = Number(req.params.layerId);
        if (!Number.isInteger(layerId) || layerId <= 0) {
            return next(new Api400Error(t('invalid_data', req.lang)));
        }

        const ticket = req.query?.ticket;
        if (ticket && !verifyTileTicket(ticket, layerId, access)) {
            return next(new Api403Error(t('map_tile_ticket_invalid', req.lang)));
        }

        try {
            const { rows } = await db.query(
                `SELECT l.id, l.code, l.name_vi, l.is_public, l.geoserver_layer,
                        l.style_name, l.metadata, l.category,
                        l.min_zoom, l.max_zoom,
                        COALESCE(lp.${permissionColumn}, false) AS allowed,
                        (SELECT array_agg(to_char(times.acquired_at AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                          ORDER BY times.acquired_at,times.id)
                         FROM raster.satellite_images times
                         WHERE times.layer_id=l.id AND times.deleted_at IS NULL) AS time_values
                 FROM gis.layers l
                 LEFT JOIN gis.layer_permissions lp
                   ON lp.layer_id = l.id AND lp.role_code = $2
                 WHERE l.id = $1 AND l.deleted_at IS NULL`,
                [layerId, req.user?.role || null],
            );
            const layer = rows[0];
            if (!layer) {
                return next(new Api404Error(t('map_layer_not_found', req.lang)));
            }
            if (ticket) {
                if (access !== 'view' && access !== 'export') {
                    return next(
                        new Api403Error(
                            t('no_permission_resource', req.lang, {
                                resource: 'layers',
                                action: access,
                            }),
                        ),
                    );
                }
                req.layerAcl = layer;
                return next();
            }
            if ((access === 'view' || access === 'export') && layer.is_public) {
                req.layerAcl = layer;
                return next();
            }
            if (!req.user) {
                return next(new Api401Error(t('please_login', req.lang)));
            }
            // Edit/delete luôn bắt buộc đối chiếu gis.layer_permissions.can_edit/can_delete.
            if (layer.allowed !== true) {
                return next(
                    new Api403Error(
                        t('no_permission_resource', req.lang, {
                            resource: 'layers',
                            action: access,
                        }),
                    ),
                );
            }
            req.layerAcl = layer;
            return next();
        } catch (error) {
            return next(error);
        }
    };
};

module.exports = { requireLayerAccess };
