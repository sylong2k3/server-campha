'use strict';

/**
 * Season / dry-window helpers for M5 trend analysis.
 *
 * computeDrySeason() is the primary entry point for the monitoring model:
 *   monitorStart  →  picks the most recent dry-season window that ended
 *                    before the monitoring period begins.
 *
 * buildSeasons() / buildDryWindow() are kept for backward-compatibility with
 * tests and any legacy annual-analysis code paths.
 *
 * @ported-from new_code.js — function computeDrySeason() (§4)
 */

const SEASON_LABELS = Object.freeze(['Xuân', 'Hạ', 'Thu', 'Đông']);

/**
 * Build the 4 seasonal analysis windows from a given year.
 * Winter extends into the following year.
 *
 * @param {number} year  Integer analysis year (e.g. 2023)
 * @returns {{ label: string, start: string, end: string }[]}
 */
function lastDayOfFeb(year) {
  // Day 0 of March = last day of February in that year.
  return new Date(year, 2, 0).getDate();
}

function buildSeasons(year) {
  if (!Number.isInteger(year) || year < 2014 || year > 2100) {
    throw new Error(`buildSeasons: invalid analysis year ${year}`);
  }
  const next = year + 1;
  const winterEnd = `${next}-02-${String(lastDayOfFeb(next)).padStart(2, '0')}`;
  return [
    { label: 'Xuân', start: `${year}-03-01`, end: `${year}-05-31` },
    { label: 'Hạ',   start: `${year}-06-01`, end: `${year}-08-31` },
    { label: 'Thu',  start: `${year}-09-01`, end: `${year}-11-30` },
    { label: 'Đông', start: `${year}-12-01`, end: winterEnd },
  ];
}

/**
 * Build the dry-season reference window (01/01 – 30/04 of the analysis year).
 *
 * @param {number} year
 * @returns {{ start: string, end: string }}
 */
function buildDryWindow(year) {
  if (!Number.isInteger(year) || year < 2014 || year > 2100) {
    throw new Error(`buildDryWindow: invalid analysis year ${year}`);
  }
  return { start: `${year}-01-01`, end: `${year}-04-30` };
}

/**
 * Derive the dry-season reference window from a monitoring-period start date.
 *
 * Logic (mirrors new_code.js §4 computeDrySeason):
 *   1. Compute the last calendar day of dryMonthEnd in the same year as monitorStart.
 *   2. If that date falls before monitorStart → use current year's dry season.
 *   3. Otherwise → use the previous year's dry season.
 *
 * Example (dryMonthStart=1, dryMonthEnd=4):
 *   monitorStart = '2025-09-01' → dry = '2025-01-01' .. '2025-04-30'
 *   monitorStart = '2025-03-01' → dry = '2024-01-01' .. '2024-04-30'
 *
 * @param {string} monitorStartStr — ISO-8601 date 'YYYY-MM-DD'
 * @param {number} [dryMonthStart=1]
 * @param {number} [dryMonthEnd=4]
 * @returns {{ start: string, end: string }}
 */
function computeDrySeason(monitorStartStr, dryMonthStart = 1, dryMonthEnd = 4) {
  const ms = new Date(monitorStartStr + 'T00:00:00Z');
  const y  = ms.getUTCFullYear();
  // Last day of dryMonthEnd in year y (Date.UTC month is 0-indexed; day 0 = last of prev month)
  const dryEndOfY = new Date(Date.UTC(y, dryMonthEnd, 0));
  const yr = dryEndOfY < ms ? y : y - 1;
  // Last calendar day of dryMonthEnd in the chosen year
  const lastDay = new Date(Date.UTC(yr, dryMonthEnd, 0)).getUTCDate();
  const pad2 = (n) => String(n).padStart(2, '0');
  return {
    start: `${yr}-${pad2(dryMonthStart)}-01`,
    end:   `${yr}-${pad2(dryMonthEnd)}-${pad2(lastDay)}`,
  };
}

module.exports = { buildSeasons, buildDryWindow, computeDrySeason, SEASON_LABELS };
