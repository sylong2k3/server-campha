'use strict';

/**
 * Season generation for FINAL M5 trend analysis.
 *
 * FINAL replaces explicit period arrays with a single analysisYear that
 * auto-generates the 4 standard Vietnamese seasons:
 *   Xuân  (Spring) : 01/03 – 31/05
 *   Hạ    (Summer) : 01/06 – 31/08
 *   Thu   (Autumn) : 01/09 – 30/11
 *   Đông  (Winter) : 01/12 – 28/02 (next year)
 *
 * @ported-from final_code.js — function buildSeasons(year) lines 60-67
 */

const SEASON_LABELS = Object.freeze(['Xuân', 'Hạ', 'Thu', 'Đông']);

/**
 * Build the 4 seasonal analysis windows from a given year.
 * Winter extends into the following year.
 *
 * @param {number} year  Integer analysis year (e.g. 2023)
 * @returns {{ label: string, start: string, end: string }[]}
 */
function buildSeasons(year) {
  if (!Number.isInteger(year) || year < 2014 || year > 2100) {
    throw new Error(`buildSeasons: invalid analysis year ${year}`);
  }
  const next = year + 1;
  return [
    { label: 'Xuân', start: `${year}-03-01`, end: `${year}-05-31` },
    { label: 'Hạ',   start: `${year}-06-01`, end: `${year}-08-31` },
    { label: 'Thu',  start: `${year}-09-01`, end: `${year}-11-30` },
    { label: 'Đông', start: `${year}-12-01`, end: `${next}-02-28` },
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

module.exports = { buildSeasons, buildDryWindow, SEASON_LABELS };
