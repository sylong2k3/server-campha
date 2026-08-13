/**
 * Dọn dẹp dữ liệu kiểm thử khỏi bảng cms.news:
 *  1. Soft-delete tin tức có tiền tố test (MOBACC, fixture kiểm thử mobile, v.v.)
 *  2. Soft-delete tin tức bị lỗi font (tiêu đề chứa ký tự thay thế Unicode U+FFFD
 *     hoặc chuỗi rỗng/chỉ whitespace sau khi trim)
 *
 * An toàn: chỉ SET deleted_at, không xóa vật lý.
 * Idempotent: bỏ qua bản ghi đã có deleted_at.
 *
 * Chạy: node src/database/seeds/006_cleanup_test_data.seed.js
 */
'use strict';

require('dotenv').config();

const db = require('../../configs/database');

// ---------------------------------------------------------------------------
//  Danh sách pattern tiêu đề cần xoá (ILIKE — không phân biệt hoa thường)
// ---------------------------------------------------------------------------
const TEST_TITLE_PATTERNS = [
    // Tin tức do api-mobile-bootstrap.js tạo ra (prefix mặc định MOBACC)
    'MOBACC %',
    'mobacc %',
    '% Tin kiểm thử mobile %',
    '% tin kiem thu mobile %',
    // Các fixture prefix thường dùng khi chạy test với biến môi trường khác
    'MOBTEST %',
    'FIXTURE %',
    'TEST_NEWS %',
    // Tin nháp trống không có nội dung thực
    'Tin tức test%',
    'Test tin tức%',
    'Bài test%',
];

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
(async () => {
    try {
        let deletedTest  = 0;
        let deletedFont  = 0;
        let totalSkipped = 0;

        // 1. Xoá tin kiểm thử theo pattern tiêu đề
        for (const pattern of TEST_TITLE_PATTERNS) {
            const { rows } = await db.query(
                `SELECT id, title FROM cms.news
                 WHERE title ILIKE $1
                   AND deleted_at IS NULL`,
                [pattern],
            );

            for (const row of rows) {
                await db.query(
                    `UPDATE cms.news SET deleted_at = NOW() WHERE id = $1`,
                    [row.id],
                );
                console.log(`  [DEL-TEST] #${row.id} "${row.title.substring(0, 70)}"`);
                deletedTest++;
            }

            if (rows.length === 0) {
                totalSkipped++;
            }
        }

        // 2. Xoá tin bị lỗi font (tiêu đề chứa ký tự replacement U+FFFD hoặc
        //    các chuỗi dấu hiệu encoding sai phổ biến khi import từ Latin-1)
        const { rows: fontRows } = await db.query(
            `SELECT id, title FROM cms.news
             WHERE deleted_at IS NULL
               AND (
                   -- Ký tự thay thế Unicode (dấu hiệu rõ nhất của lỗi encoding)
                   title LIKE '%�%'
                   -- Chuỗi 2+ byte không hợp lệ trong Latin-1 bị giải mã sai sang UTF-8
                OR title ~ '[\\xC0-\\xC1\\xF5-\\xFF]'
                   -- Tiêu đề trống hoặc chỉ có khoảng trắng
                OR btrim(title) = ''
               )`,
        );

        for (const row of fontRows) {
            await db.query(
                `UPDATE cms.news SET deleted_at = NOW() WHERE id = $1`,
                [row.id],
            );
            console.log(`  [DEL-FONT] #${row.id} "${row.title.substring(0, 70)}"`);
            deletedFont++;
        }

        // 3. Báo cáo
        console.log(`\nDọn dẹp dữ liệu kiểm thử hoàn tất:`);
        console.log(`  Tin kiểm thử bị xoá   : ${deletedTest}`);
        console.log(`  Tin lỗi font bị xoá   : ${deletedFont}`);
        console.log(`  Pattern không khớp     : ${totalSkipped}/${TEST_TITLE_PATTERNS.length}`);

        if (deletedTest + deletedFont === 0) {
            console.log('\n  ✓ Không có dữ liệu cần dọn dẹp — cơ sở dữ liệu đã sạch.');
        }

        await db.pool.end();
        process.exit(0);
    } catch (e) {
        console.error('CLEANUP FAILED:', e.message, e.stack);
        await db.pool.end().catch(() => {});
        process.exit(1);
    }
})();
