const OS_GEO4W_BIN = 'C:\\OSGeo4W\\bin';
const OS_GEO4W_GDAL_DATA = 'C:\\OSGeo4W\\apps\\gdal\\share\\gdal';
const OS_GEO4W_PROJ_DATA = 'C:\\OSGeo4W\\share\\proj';

// The raster ingest worker shells out to `gdalinfo` and `gdal_translate`.
// PM2 does not inherit changes made to the Windows user PATH after its daemon
// starts, so make the OSGeo4W toolchain explicit for this Windows deployment.
const withOsGeo4w = (env) => {
  if (process.platform !== 'win32') {
    return env;
  }

  const inheritedPath = process.env.Path || process.env.PATH || '';
  const pathEntries = inheritedPath.split(';').filter(Boolean);
  const hasOsGeo4w = pathEntries.some(
    (entry) => entry.toLowerCase() === OS_GEO4W_BIN.toLowerCase(),
  );

  return {
    ...env,
    Path: hasOsGeo4w ? inheritedPath : [OS_GEO4W_BIN, ...pathEntries].join(';'),
    GDAL_DATA: OS_GEO4W_GDAL_DATA,
    PROJ_DATA: OS_GEO4W_PROJ_DATA,
    PROJ_LIB: OS_GEO4W_PROJ_DATA,
  };
};

module.exports = {
  apps: [
    {
      name: 'server-campha-hydromap',
      script: './server.js',
      cwd: __dirname,
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      restart_delay: 3000,
      kill_timeout: 10000,

      time: true,
      merge_logs: true,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      env: withOsGeo4w({
        NODE_ENV: 'production',
        PORT: 3006,
      }),
      env_production: withOsGeo4w({
        NODE_ENV: 'production',
        PORT: 3006,
      }),
      env_development: {
        NODE_ENV: 'development',
        PORT: 3006,
      },
    },
  ],
};
