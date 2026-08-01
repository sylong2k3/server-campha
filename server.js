// ── Timezone: khoá về VN (+07:00) ────────────────────────────────────────────
// PHẢI set trước MỌI `require` khác — vì Date/logger cache TZ lúc khởi tạo.
process.env.TZ = process.env.TZ || 'Asia/Ho_Chi_Minh';

const app = require("./src/app");
const db = require("./src/configs/database");
const { initializeEarthEngine, isInitialized } = require("./src/configs/gge");
const minioConfig = require("./src/configs/minioClient");
const { initMinio, healthCheck: minioHealthCheck } = minioConfig;
const geoserverConfig = require("./src/configs/geoserver");
const geoserverClient = require("./src/utils/geoserver.client");

const tokenCleanupJob = require("./src/jobs/token-cleanup.job");
const {
  initWebSocketServer,
  closeWebSocketServer,
} = require("./src/realtime/websocket.server");
const systemLogger = require("./src/utils/systemLogger.util");
const layerWorkerManager = require('./src/workers/layer-worker.manager');
require("dotenv").config();

const PORT = process.env.PORT || 8881;
const HOST = process.env.HOST || "0.0.0.0";
const WS_PATH = "/ws";

const IS_SINGLETON_WORKER =
  !process.env.CLUSTER_WORKER_ID || process.env.CLUSTER_WORKER_ID === "0";

let server;
let isShuttingDown = false;

function printStartupBanner({ dbStatus, minioStatus, earthEngineStatus, geoserverStatus }) {
  const publicHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  const env = process.env.NODE_ENV || "development";
  const appName = process.env.APP_NAME || "WebGIS Cẩm Phả";

  const COL = 13;
  const row = (label, value) => `  ${label.padEnd(COL)}: ${value}`;

  const appRows = [
    row("HTTP",        `http://${publicHost}:${PORT}`),
    row("WebSocket",   `ws://${publicHost}:${PORT}${WS_PATH}`),
    row("Environment", env),
  ];
  const svcRows = [
    row("PostgreSQL",    dbStatus),
    row("MinIO",         minioStatus),
    row("GeoServer",     geoserverStatus),
    row("Earth Engine",  earthEngineStatus),
  ];

  const allRows = [appName, ...appRows, null, ...svcRows];
  const width = Math.max(...allRows.filter(Boolean).map((l) => l.length), 48);
  const bar = "─".repeat(width + 2);

  const ln = (content) => console.log(`│ ${content.padEnd(width)} │`);

  console.log(`\n┌${bar}┐`);
  ln(`  ${appName}`);
  console.log(`├${bar}┤`);
  appRows.forEach(ln);
  console.log(`├${bar}┤`);
  svcRows.forEach(ln);
  console.log(`└${bar}┘\n`);
}

async function getDatabaseStartupStatus() {
  try {
    await db.query("SELECT 1");
    return "✓ Connected";
  } catch (error) {
    const reason = error.code || error.message || "Unknown";
    return `✗ Error (${reason})`;
  }
}

async function getServiceConnectionStatuses() {
  // DB/GeoServer checks and MinIO init+healthcheck are independent — run concurrently
  // instead of paying the sum of their round-trips at every boot.
  const storageEnabled = minioConfig.isEnabled();
  const geoserverEnabled = geoserverConfig.isEnabled();
  const [dbStatus, minioOk, geoserverOk] = await Promise.all([
    getDatabaseStartupStatus(),
    storageEnabled ? initMinio().then(minioHealthCheck) : false,
    geoserverEnabled ? geoserverClient.healthCheck() : false,
  ]);

  const minioStatus = !storageEnabled ? '— Disabled'
    : minioOk ? '✓ Connected' : '✗ Unavailable';
  const geoserverStatus = !geoserverEnabled ? '— Disabled'
    : geoserverOk ? '✓ Connected' : '✗ Unavailable';

  return { dbStatus, minioStatus, geoserverStatus };
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) { return; }
  isShuttingDown = true;

  console.log(
    `\nReceived ${signal} signal. Shutting down server gracefully...`,
  );
  systemLogger.logWarn("server", `Server đang tắt (tín hiệu: ${signal})`, { signal });

  tokenCleanupJob.stop();
  closeWebSocketServer();
  await layerWorkerManager.stop();

  if (server) {
    server.close(async () => {
      console.log("HTTP server closed");
      try {
        await db.pool.end();
        console.log("Database connection closed");
      } catch (error) {
        console.error("Error closing database connection:", error);
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }

  setTimeout(() => {
    console.error("Graceful shutdown timeout, forcing exit...");
    process.exit(1);
  }, 10000).unref();
}

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION! Shutting down server...");
  console.error(error.name, error.message);
  console.error(error.stack);
  systemLogger.logError("server", `Uncaught exception: ${error.message}`, { stack: error.stack });
  gracefulShutdown("uncaughtException").finally(() => process.exit(1));
});

function startServer({ earthEngineStatus, dbStatus, minioStatus, geoserverStatus }) {
  server = app.listen(PORT, HOST, () => {
    printStartupBanner({ dbStatus, minioStatus, earthEngineStatus, geoserverStatus });
    systemLogger.logInfo("server", `Server khởi động thành công trên cổng ${PORT}`, {
      port: PORT,
      host: HOST,
      env: process.env.NODE_ENV || "development",
    });
  });

  // Kích hoạt WebSocket realtime (dùng chung HTTP server qua sự kiện 'upgrade').
  initWebSocketServer(server, { path: WS_PATH });

  if (IS_SINGLETON_WORKER) {
    tokenCleanupJob.start();
    layerWorkerManager.start();
  }

  process.on("unhandledRejection", (error) => {
    console.error("UNHANDLED PROMISE REJECTION! Shutting down server...");
    console.error(error.name, error.message);
    console.error(error.stack);
    systemLogger.logError("server", `Unhandled promise rejection: ${error.message}`, { stack: error.stack });
    gracefulShutdown("unhandledRejection");
  });

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  return server;
}

const initializeAndStartServer = async () => {
  console.log("Đang khởi tạo Earth Engine...");

  // Earth Engine auth (network round-trip + retry/backoff) is independent of
  // DB/MinIO/GeoServer — run both concurrently instead of blocking one on the other.
  const [earthEngineResult, statuses] = await Promise.all([
    initializeEarthEngine()
      .then(() => {
        console.log(`Earth Engine isInitialized: ${isInitialized()}`);
        console.log("✓ Earth Engine khởi tạo thành công");
        return "Initialized";
      })
      .catch((error) => {
        // Nếu chỉ là lỗi Earth Engine, tiếp tục khởi động server với trạng thái cảnh báo
        console.warn(`⚠ Earth Engine initialization warning: ${error.message}`);
        console.warn("  Server vẫn khởi động bình thường. GEE sẽ không hoạt động.");
        return "⚠ Unavailable";
      }),
    getServiceConnectionStatuses(),
  ]);

  return startServer({ ...statuses, earthEngineStatus: earthEngineResult });
};

initializeAndStartServer();

module.exports = server;
