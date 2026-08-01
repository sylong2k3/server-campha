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
const ldapConfig = require('./src/configs/ldap');
const layerWorkerManager = require('./src/workers/layer-worker.manager');
require("dotenv").config();

const PORT = process.env.PORT || 8881;
const HOST = process.env.HOST || "0.0.0.0";
const WS_PATH = "/ws";

const IS_SINGLETON_WORKER =
  !process.env.CLUSTER_WORKER_ID || process.env.CLUSTER_WORKER_ID === "0";

let server;
let isShuttingDown = false;

function formatField(label, value) {
  return `${label.padEnd(14)}: ${value}`;
}

function printStartupBanner({ dbStatus, minioStatus, earthEngineStatus, geoserverStatus }) {
  const publicHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  const lines = [
    "APP QUẢN LÝ GIS CẨM PHẢ",
    formatField("HTTP", `http://${publicHost}:${PORT}`),
    formatField("WebSocket", `ws://${publicHost}:${PORT}${WS_PATH}`),
    formatField("Environment", process.env.NODE_ENV || "development"),
    formatField("Database", process.env.DB_NAME || "(not configured)"),
    formatField("DB Host",
      `${process.env.DB_HOST || "(not configured)"}:${process.env.DB_PORT || "(not configured)"}`,
    ),
    formatField("PostgreSQL", dbStatus),
    formatField("MinIO",      minioStatus),
    formatField("Earth Engine", earthEngineStatus),
    formatField("GeoServer",    geoserverStatus),
  ];

  const width = Math.max(...lines.map((line) => line.length), 48);
  const border = "─".repeat(width + 2);

  console.log(`\n┌${border}┐`);

  lines.forEach((line, index) => {
    console.log(`│ ${line.padEnd(width)} │`);
    if (index === 0) {
      console.log(`├${border}┤`);
    }
  });

  console.log(`└${border}┘`);
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

  const minioStatus = !storageEnabled
    ? 'Disabled'
    : minioOk
      ? `✓ Connected (${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || 9000})`
      : `⚠ Unavailable (${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || 9000})`;
  const geoserverStatus = !geoserverEnabled
    ? 'Disabled'
    : geoserverOk
      ? `✓ Connected (${process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver'})`
      : `⚠ Unavailable (${process.env.GEOSERVER_URL || 'http://localhost:8080/geoserver'})`;

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
  try {
    if (ldapConfig.isEnabled()) {
        ldapConfig.getConfig();
    }
  } catch (err) {
    console.error("Failed to validate LDAP configuration:", err.message);
    process.exit(1);
  }

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
