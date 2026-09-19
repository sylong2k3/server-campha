'use strict';

/**
 * Dịch vụ tự động hóa kịch bản ngập lụt theo dự báo thời tiết 24 giờ và hỗ trợ khóa thủ công (Manual Override).
 *
 * Nhiệm vụ:
 * 1. Kiểm tra các mốc giờ trong lịch trình (flood_forecast_schedule).
 * 2. Bỏ qua hoàn toàn các mốc giờ đã bị người dùng khóa thủ công (is_manual_override = true hoặc status = 'MANUAL').
 * 3. Đối với mốc giờ tự động có xác suất mưa > 50% và lượng mưa > 0 mm:
 *    - Tự động tìm kịch bản ngập lụt hiện trạng (hien_trang) phù hợp.
 *    - Cập nhật kịch bản sang hoạt động với nguồn 'AUTO' và lưu lượng mưa dự báo.
 *    - Chỉ phát thông báo nếu kịch bản chuyển từ chưa kích hoạt sang kích hoạt.
 *    - Đánh dấu mốc lịch trình là 'APPLIED'.
 * 4. Cung cấp API áp dụng thủ công (applyManualOverride) và khôi phục tự động (resetManualOverrideToAuto).
 */

const floodForecastRepo = require('../../repositories/flood-forecast.repository');
const floodScenarioRepo = require('../../repositories/flood-scenario.repository');
const notificationEvents = require('../notification-events.service');
const systemLogger = require('../../utils/systemLogger.util');

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function getDateInTimeZone(date = new Date(), timeZone = VIETNAM_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Xử lý các mốc lịch trình tới hạn (scheduled_time <= targetTime) và đang PENDING (chưa bị ghi đè thủ công).
 *
 * @param {Object} options
 * @param {Date} [options.targetTime] Mốc thời gian kiểm tra (mặc định là thời điểm hiện tại)
 * @returns {Promise<{processed: number, applied: number, skipped: number, errors: number}>}
 */
async function processDueScheduleSlots({ targetTime = new Date() } = {}) {
    let slots;
    try {
        slots = await floodForecastRepo.getDuePendingSlots(targetTime);
    } catch (error) {
        systemLogger.logError('forecast_auto_scenario', 'Lỗi truy vấn lịch trình dự báo tới hạn', {
            error: error?.message,
        });
        return { processed: 0, applied: 0, skipped: 0, errors: 1 };
    }

    if (!Array.isArray(slots) || slots.length === 0) {
        return { processed: 0, applied: 0, skipped: 0, errors: 0 };
    }

    let applied = 0;
    let skipped = 0;
    let errors = 0;

    for (const slot of slots) {
        try {
            // Kiểm tra phòng vệ: nếu slot đã bị khóa thủ công thì bỏ qua, cron tuyệt đối không chỉnh lại
            if (slot.is_manual_override || slot.status === 'MANUAL') {
                continue;
            }

            const chanceOfRain = Number(slot.chance_of_rain) || 0;
            const precipMm = Number(slot.precip_mm) || 0;

            // Điều kiện: tỷ lệ mưa trên 50% và lượng mưa > 0
            if (chanceOfRain > 50 && precipMm > 0) {
                // Tìm kịch bản hiện trạng phù hợp
                const matchedScenario = await floodScenarioRepo.findMatchingScenario(precipMm, null, undefined, {
                    type: 'hien_trang',
                });

                if (matchedScenario) {
                    const wasActive = Boolean(matchedScenario.is_active);

                    // Tắt các kịch bản hiện trạng khác đang kích hoạt
                    const allActive = await floodScenarioRepo.listAll({ activeOnly: true, limit: 100 });
                    const otherActive = (allActive?.items || []).filter(
                        (s) => s.id !== matchedScenario.id && s.type === 'hien_trang',
                    );
                    for (const s of otherActive) {
                        await floodScenarioRepo.update(s.id, { isActive: false });
                    }

                    // Kích hoạt kịch bản mục tiêu với nguồn AUTO
                    await floodScenarioRepo.update(matchedScenario.id, {
                        isActive: true,
                        currentRainfall: precipMm,
                        rainfallSource: 'AUTO',
                    });

                    // Đánh dấu slot là APPLIED
                    await floodForecastRepo.updateScheduleSlot(slot.id, {
                        status: 'APPLIED',
                        appliedScenarioId: matchedScenario.id,
                    });

                    // Quy tắc: Chỉ phát thông báo khi kịch bản chuyển từ chưa kích hoạt sang kích hoạt
                    if (!wasActive) {
                        const dateStr = slot.forecast_date ? String(slot.forecast_date).slice(0, 10) : '';
                        const hourPart = slot.hour_str ? slot.hour_str.slice(0, 2) : '00';
                        const eventHour = dateStr ? `${dateStr}T${hourPart}` : undefined;

                        await notificationEvents.notifyHydroScenarioTriggered({
                            scenario: matchedScenario,
                            layerCode: matchedScenario.layer_code,
                            rainVal: precipMm,
                            tideVal: null,
                            eventHour,
                            source: 'AUTO',
                        });
                    }

                    systemLogger.logInfo(
                        'forecast_auto_scenario',
                        `Tự động cập nhật kịch bản ngập '${matchedScenario.name_vi}' cho mốc ${slot.hour_str} (mưa: ${precipMm}mm, tỉ lệ: ${chanceOfRain}%)`,
                        {
                            slotId: slot.id,
                            scenarioId: matchedScenario.id,
                            precipMm,
                            chanceOfRain,
                            newlyActivated: !wasActive,
                        },
                    );

                    applied++;
                } else {
                    // Không tìm thấy kịch bản hiện trạng phù hợp
                    await floodForecastRepo.updateScheduleSlot(slot.id, {
                        status: 'SKIPPED',
                        appliedScenarioId: null,
                    });
                    skipped++;
                }
            } else if (precipMm === 0) {
                // Mốc tự động có lượng mưa bằng 0 mm: Máy chạy (cron) tự động tắt TẤT CẢ các kịch bản đang kích hoạt (cả 3 nhóm)
                await floodScenarioRepo.deactivateAllActive();

                await floodForecastRepo.updateScheduleSlot(slot.id, {
                    status: 'SKIPPED',
                    appliedScenarioId: null,
                });
                skipped++;
            } else {
                // Mốc tự động có mưa nhưng xác suất <= 50%: chỉ tắt các kịch bản hiện trạng đang hoạt động
                await floodScenarioRepo.deactivateAllActive({ types: ['hien_trang'] });

                await floodForecastRepo.updateScheduleSlot(slot.id, {
                    status: 'SKIPPED',
                    appliedScenarioId: null,
                });
                skipped++;
            }
        } catch (slotError) {
            errors++;
            systemLogger.logError('forecast_auto_scenario', `Lỗi xử lý mốc lịch trình #${slot.id}`, {
                slotId: slot.id,
                error: slotError?.message,
            });
            try {
                await floodForecastRepo.updateScheduleSlot(slot.id, {
                    status: 'FAILED',
                    appliedScenarioId: null,
                });
            } catch {
                // ignore secondary failure
            }
        }
    }

    return {
        processed: slots.length,
        applied,
        skipped,
        errors,
    };
}

/**
 * Thiết lập ghi đè thủ công cho một khung giờ cụ thể.
 * Đánh dấu mốc giờ là 'MANUAL', cập nhật kịch bản ngập và bảo lưu để cron không ghi đè lại.
 */
async function applyManualOverride({ hour, date, rainfall, tide = null, scenarioId = null }) {
    const forecastDate = date || getDateInTimeZone();
    const hourStr = hour || new Date().toTimeString().slice(0, 5);
    const rainVal = Number(rainfall) || 0;
    const tideVal = tide !== null && tide !== undefined && tide !== '' ? Number(tide) : null;

    if (rainVal === 0) {
        // Tắt toàn bộ kịch bản đang kích hoạt (cả 3 nhóm: hiện trạng, cải tạo, quy hoạch)
        const deactivatedScenarios = await floodScenarioRepo.deactivateAllActive();

        // Cập nhật slot trong bảng lịch trình thành MANUAL với scenarioId = null
        const slot = await floodForecastRepo.setSlotManualOverride({
            forecastDate,
            hourStr,
            rainfall: 0,
            scenarioId: null,
        });

        systemLogger.logInfo(
            'forecast_auto_scenario',
            `Người dùng thiết lập thủ công tắt kịch bản cho mốc ${hourStr} (${forecastDate}): 0 mm, đã tắt ${deactivatedScenarios.length} kịch bản`,
            {
                forecastDate,
                hourStr,
                rainfall: 0,
                deactivatedCount: deactivatedScenarios.length,
            },
        );

        return {
            success: true,
            action: 'deactivated',
            deactivatedCount: deactivatedScenarios.length,
            deactivatedIds: deactivatedScenarios.map((s) => s.id),
            slot,
            scenario: null,
        };
    }

    let targetScenario = null;
    if (scenarioId) {
        targetScenario = await floodScenarioRepo.findById(scenarioId);
    }
    if (!targetScenario) {
        targetScenario = await floodScenarioRepo.findMatchingScenario(rainVal, tideVal, undefined, {
            type: 'hien_trang',
        });
    }

    if (!targetScenario) {
        throw new Error('Không tìm thấy kịch bản ngập lụt hiện trạng phù hợp');
    }

    const wasActive = Boolean(targetScenario.is_active);

    // Tắt các kịch bản hiện trạng khác đang kích hoạt
    const allActive = await floodScenarioRepo.listAll({ activeOnly: true, limit: 100 });
    const otherActive = (allActive?.items || []).filter(
        (s) => s.id !== targetScenario.id && s.type === 'hien_trang',
    );
    for (const s of otherActive) {
        await floodScenarioRepo.update(s.id, { isActive: false });
    }

    // Kích hoạt kịch bản mục tiêu với nguồn MANUAL
    const updated = await floodScenarioRepo.update(targetScenario.id, {
        isActive: true,
        currentRainfall: rainVal,
        rainfallSource: 'MANUAL',
        currentTide: tideVal,
        tideSource: 'MANUAL',
    });

    // Cập nhật slot trong bảng lịch trình thành MANUAL
    const slot = await floodForecastRepo.setSlotManualOverride({
        forecastDate,
        hourStr,
        rainfall: rainVal,
        scenarioId: targetScenario.id,
    });

    // Chỉ phát thông báo nếu kịch bản chuyển sang trạng thái kích hoạt (false -> true)
    if (!wasActive && targetScenario.type === 'hien_trang') {
        await notificationEvents.notifyHydroScenarioTriggered({
            scenario: updated,
            layerCode: targetScenario.layer_code,
            rainVal,
            tideVal,
            eventHour: `${forecastDate}T${hourStr.slice(0, 2)}`,
            source: 'MANUAL',
        });
    }

    systemLogger.logInfo(
        'forecast_auto_scenario',
        `Người dùng thiết lập thủ công cho mốc ${hourStr} (${forecastDate}): ${rainVal} mm, kịch bản '${targetScenario.name_vi}'`,
        {
            forecastDate,
            hourStr,
            rainfall: rainVal,
            scenarioId: targetScenario.id,
            newlyActivated: !wasActive,
        },
    );

    return {
        success: true,
        slot,
        scenario: updated,
    };
}

/**
 * Khôi phục khung giờ về chế độ tự động (trả quyền điều khiển lại cho cronjob).
 */
async function resetManualOverrideToAuto({ hour, date }) {
    const forecastDate = date || getDateInTimeZone();
    const hourStr = hour || new Date().toTimeString().slice(0, 5);

    const slot = await floodForecastRepo.resetSlotToAuto({ forecastDate, hourStr });

    systemLogger.logInfo(
        'forecast_auto_scenario',
        `Đã khôi phục mốc giờ ${hourStr} (${forecastDate}) về chế độ tự động hóa`,
        {
            forecastDate,
            hourStr,
        },
    );

    return {
        success: true,
        slot,
    };
}

/**
 * Lấy lịch trình các mốc giờ trong ngày.
 */
async function getForecastSchedule(date) {
    const forecastDate = date || getDateInTimeZone();
    return floodForecastRepo.getScheduleByDate(forecastDate);
}

module.exports = {
    processDueScheduleSlots,
    applyManualOverride,
    resetManualOverrideToAuto,
    getForecastSchedule,
};
