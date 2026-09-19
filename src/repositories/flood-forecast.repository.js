'use strict';

const db = require('../configs/database');

/**
 * Lưu trữ bản chụp dự báo thời tiết 24 giờ.
 * Nếu đã tồn tại bản chụp cùng ngày và địa điểm, cập nhật nội dung mới.
 */
async function saveForecastSnapshot({ forecastDate, location = 'Cam Pha', fetchedAt = new Date(), hourlyData = [] }, client = db) {
    const res = await client.query(
        `INSERT INTO gis.flood_forecast_snapshots (forecast_date, location, fetched_at, hourly_data)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (forecast_date, location)
         DO UPDATE SET
             fetched_at = EXCLUDED.fetched_at,
             hourly_data = EXCLUDED.hourly_data
         RETURNING *`,
        [forecastDate, location, fetchedAt, JSON.stringify(hourlyData)],
    );
    return res.rows[0] || null;
}

/**
 * Tạo hoặc cập nhật các mốc giờ trong ngày vào bảng lịch trình gis.flood_forecast_schedule.
 * Chỉ cập nhật nếu trạng thái hiện tại đang là 'PENDING'.
 */
async function createOrUpdateScheduleSlots(snapshotId, forecastDate, hours = [], client = db) {
    const results = [];
    for (const h of hours) {
        const hourStr = h.hour || (h.time ? h.time.split(' ')[1] : '00:00');
        // Parse scheduled_time: nếu có timeEpoch dùng timeEpoch, hoặc fallback parse time string
        let scheduledTime;
        if (h.timeEpoch) {
            scheduledTime = new Date(h.timeEpoch * 1000);
        } else if (h.time) {
            // ISO format với múi giờ +07:00
            scheduledTime = new Date(`${h.time.replace(' ', 'T')}:00+07:00`);
        } else {
            scheduledTime = new Date(`${forecastDate}T${hourStr}:00+07:00`);
        }

        const chanceOfRain = Math.round(Number(h.chanceOfRain) || 0);
        const precipMm = Number(h.precipMm) || 0;

        const res = await client.query(
            `INSERT INTO gis.flood_forecast_schedule (
                 snapshot_id, forecast_date, hour_str, scheduled_time, chance_of_rain, precip_mm, status
             ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
             ON CONFLICT (forecast_date, hour_str)
             DO UPDATE SET
                 snapshot_id = EXCLUDED.snapshot_id,
                 scheduled_time = EXCLUDED.scheduled_time,
                 chance_of_rain = EXCLUDED.chance_of_rain,
                 precip_mm = EXCLUDED.precip_mm,
                 updated_at = NOW()
             WHERE gis.flood_forecast_schedule.status = 'PENDING'
               AND gis.flood_forecast_schedule.is_manual_override = false
             RETURNING *`,
            [snapshotId, forecastDate, hourStr, scheduledTime, chanceOfRain, precipMm],
        );
        if (res.rows[0]) {
            results.push(res.rows[0]);
        }
    }
    return results;
}

/**
 * Lấy các mốc giờ tới hạn xử lý (scheduled_time <= targetTime) và đang PENDING (chưa bị ghi đè thủ công).
 * Có hỗ trợ FOR UPDATE SKIP LOCKED khi chạy trong transaction để tránh chạy đồng thời (race condition).
 */
async function getDuePendingSlots(targetTime = new Date(), client = db, { forUpdate = false } = {}) {
    const lockClause = forUpdate ? 'FOR UPDATE SKIP LOCKED' : '';
    const res = await client.query(
        `SELECT id, snapshot_id, forecast_date, hour_str, scheduled_time,
                chance_of_rain, precip_mm, status, applied_scenario_id, is_manual_override,
                manual_rainfall, manual_updated_at, created_at, updated_at
         FROM gis.flood_forecast_schedule
         WHERE status = 'PENDING' AND is_manual_override = false AND scheduled_time <= $1
         ORDER BY scheduled_time ASC
         ${lockClause}`,
        [targetTime],
    );
    return res.rows;
}

/**
 * Đặt khung giờ sang chế độ ghi đè thủ công (MANUAL).
 * Cronjob sẽ bỏ qua khung giờ này và không ghi đè lại.
 */
async function setSlotManualOverride({ forecastDate, hourStr, rainfall, scenarioId = null }, client = db) {
    const precipMm = Number(rainfall) || 0;
    const res = await client.query(
        `UPDATE gis.flood_forecast_schedule
         SET status = 'MANUAL',
             is_manual_override = true,
             manual_rainfall = $1,
             precip_mm = $1,
             applied_scenario_id = $2,
             manual_updated_at = NOW(),
             updated_at = NOW()
         WHERE forecast_date = $3 AND hour_str = $4
         RETURNING *`,
        [precipMm, scenarioId, forecastDate, hourStr],
    );
    return res.rows[0] || null;
}

/**
 * Khôi phục khung giờ về chế độ tự động (AUTO / PENDING).
 */
async function resetSlotToAuto({ forecastDate, hourStr }, client = db) {
    const res = await client.query(
        `UPDATE gis.flood_forecast_schedule
         SET status = 'PENDING',
             is_manual_override = false,
             manual_rainfall = NULL,
             manual_updated_at = NULL,
             updated_at = NOW()
         WHERE forecast_date = $1 AND hour_str = $2
         RETURNING *`,
        [forecastDate, hourStr],
    );
    return res.rows[0] || null;
}

/**
 * Cập nhật trạng thái của một mốc lịch trình.
 */
async function updateScheduleSlot(id, { status, appliedScenarioId = null }, client = db) {
    const res = await client.query(
        `UPDATE gis.flood_forecast_schedule
         SET status = $1,
             applied_scenario_id = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [status, appliedScenarioId, id],
    );
    return res.rows[0] || null;
}

/**
 * Lấy lịch trình theo ngày dự báo.
 */
async function getScheduleByDate(forecastDate, client = db) {
    const res = await client.query(
        `SELECT id, snapshot_id, forecast_date, hour_str, scheduled_time,
                chance_of_rain, precip_mm, status, applied_scenario_id, is_manual_override,
                manual_rainfall, manual_updated_at, created_at, updated_at
         FROM gis.flood_forecast_schedule
         WHERE forecast_date = $1
         ORDER BY scheduled_time ASC`,
        [forecastDate],
    );
    return res.rows;
}

/**
 * Lấy bản chụp mới nhất.
 */
async function getLatestSnapshot(client = db) {
    const res = await client.query(
        `SELECT id, forecast_date, location, fetched_at, hourly_data, created_at
         FROM gis.flood_forecast_snapshots
         ORDER BY forecast_date DESC, fetched_at DESC
         LIMIT 1`,
    );
    return res.rows[0] || null;
}

/**
 * Helper thực thi transaction an toàn.
 */
async function withTransaction(callback) {
    const client = await db.getClient();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    saveForecastSnapshot,
    createOrUpdateScheduleSlots,
    getDuePendingSlots,
    setSlotManualOverride,
    resetSlotToAuto,
    updateScheduleSlot,
    getScheduleByDate,
    getLatestSnapshot,
    withTransaction,
};
