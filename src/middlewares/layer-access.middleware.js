const db = require('../configs/database');
const { Api400Error, Api401Error, Api403Error, Api404Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');

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

        try {
            const { rows } = await db.query(
                `SELECT l.id, l.code, l.name_vi, l.is_public, l.geoserver_layer,
                        l.min_zoom, l.max_zoom,
                        COALESCE(lp.${permissionColumn}, false) AS allowed
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
            if (access === 'view' && layer.is_public) {
                req.layerAcl = layer;
                return next();
            }
            if (!req.user) {
                return next(new Api401Error(t('please_login', req.lang)));
            }
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
