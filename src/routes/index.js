const { Router } = require('express');
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const systemLogRoutes = require('./systemLog.routes');
const storageRoutes = require('./storage.routes');
const mapProxyRoutes = require('./map-proxy.routes');
const layerRoutes = require('./layer.routes');
const webMapRoutes = require('./web-map.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/admin/users', userRoutes.adminRouter);
router.use('/admin/system-logs', systemLogRoutes.adminRouter);
router.use('/storage', storageRoutes);
router.use('/maps', mapProxyRoutes);
router.use('/admin/layers', layerRoutes);
router.use('/web-map', webMapRoutes);

module.exports = router;
