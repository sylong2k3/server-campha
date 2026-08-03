/**
 * Seed bình luận mẫu cho các tin tức trong hệ thống Cẩm Phả.
 *
 * Yêu cầu: 001_users + 002_cms_content + 004_extra_users đã chạy.
 * Idempotent: bỏ qua bình luận đã tồn tại (so sánh user_id + news_id + content hash).
 *
 * Chạy: node src/database/seeds/005_comments.seed.js
 */
'use strict';

require('dotenv').config();

const db = require('../../configs/database');

// ---------------------------------------------------------------------------
//  Tra cứu user + bài tin theo email / title prefix
// ---------------------------------------------------------------------------
async function getUserId(email) {
    const { rows } = await db.query(
        `SELECT id FROM auth.users WHERE lower(email)=lower($1) AND deleted_at IS NULL`,
        [email],
    );
    if (!rows[0]) {
        throw new Error(`User không tồn tại: ${email}`);
    }
    return rows[0].id;
}

async function getNewsId(titlePrefix) {
    const { rows } = await db.query(
        `SELECT id FROM cms.news
         WHERE lower(title) LIKE lower($1) AND deleted_at IS NULL
         LIMIT 1`,
        [`${titlePrefix}%`],
    );
    if (!rows[0]) {
        throw new Error(`Tin tức không tìm thấy với prefix: "${titlePrefix}"`);
    }
    return rows[0].id;
}

// ---------------------------------------------------------------------------
//  Dữ liệu bình luận
//  Mỗi entry: { newsPrefix, comments: [{ email, content, status, moderatedBy? }] }
// ---------------------------------------------------------------------------
const COMMENT_DATA = [
    // ── Bài 1: Hệ thống KTTV tự động ─────────────────────────────────────
    {
        newsPrefix: 'Hệ thống quan trắc khí tượng thủy văn tự động',
        moderatorEmail: 'admin@campha.gov.vn',
        comments: [
            {
                email: 'nguyen.thi.lan@gmail.com',
                content:
                    'Rất vui khi thành phố đầu tư hệ thống quan trắc hiện đại như thế này. Hy vọng dữ liệu sẽ được cập nhật liên tục để người dân theo dõi được.',
                status: 'approved',
            },
            {
                email: 'tran.van.hung@gmail.com',
                content:
                    'Tôi sống ở Quang Hanh, khu vực hay bị ngập mỗi khi mưa to. Với trạm đo mưa mới này hy vọng sẽ có cảnh báo sớm hơn cho chúng tôi.',
                status: 'approved',
            },
            {
                email: 'le.thi.mai@gmail.com',
                content:
                    'Trạm Mông Dương đặt ở đâu vậy ạ? Gần sông hay ở trên cao? Vì khu tôi ở hay bị lũ từ sông tràn vào.',
                status: 'approved',
            },
            {
                email: 'pham.van.duc@gmail.com',
                content:
                    'Cho hỏi dữ liệu quan trắc này có hiển thị công khai trên website không hay chỉ nội bộ?',
                status: 'approved',
            },
            {
                email: 'hoang.thi.hoa@gmail.com',
                content:
                    'Tốt quá! Mong rằng trạm ở Dương Huy cũng hoạt động ổn định vì khu vực đó địa hình phức tạp, thường xảy ra sạt lở.',
                status: 'approved',
            },
            {
                email: 'vu.minh.tuan@gmail.com',
                content:
                    'Thiết bị Vaisala và OTT đều là hàng của Phần Lan và Đức, chất lượng tốt. Bảo dưỡng đúng chu kỳ là dùng được lâu dài.',
                status: 'approved',
            },
            {
                email: 'do.thi.thu@gmail.com',
                content:
                    'Chúc mừng thành phố! Cần tuyên truyền rộng rãi để người dân biết cách theo dõi và hiểu ý nghĩa các chỉ số.',
                status: 'approved',
            },
            {
                email: 'bui.van.long@gmail.com',
                content:
                    'Mua sắm thiết bị đắt tiền như vậy ai bảo dưỡng? Hy vọng không bị bỏ hoang như mấy cái trạm cũ.',
                status: 'pending',
            },
            {
                email: 'truong.thi.nhung@gmail.com',
                content:
                    'Nếu có app điện thoại để xem trực tiếp thì tiện lắm, mưa to chỉ cần mở điện thoại là biết ngay mưa bao nhiêu mm rồi.',
                status: 'pending',
            },
        ],
    },

    // ── Bài 2: Cảnh báo mưa lớn ──────────────────────────────────────────
    {
        newsPrefix: 'Cảnh báo mưa lớn diện rộng tại Cẩm Phả',
        moderatorEmail: 'ubnd@campha.gov.vn',
        comments: [
            {
                email: 'tran.van.hung@gmail.com',
                content:
                    'Ngày hôm qua mưa to thật, đường vào khu Quang Hanh ngập gần nửa bánh xe. Cảm ơn thông báo kịp thời!',
                status: 'approved',
            },
            {
                email: 'le.thi.mai@gmail.com',
                content:
                    'Khu Mông Dương nhà tôi mưa từ 10h tối đến 3h sáng, nước dâng lên sàn nhà. Mong thành phố có giải pháp thoát nước sớm.',
                status: 'approved',
            },
            {
                email: 'pham.van.duc@gmail.com',
                content:
                    'Đề nghị cơ quan chức năng cho xe ủi thông cống thoát nước trước mùa mưa lũ, đừng chờ ngập mới xử lý.',
                status: 'approved',
            },
            {
                email: 'dinh.van.son@gmail.com',
                content:
                    'Tôi đang ở Cẩm Sơn, khu này đất đồi nên lo ngại sạt lở hơn ngập. Mong có bản đồ nguy cơ sạt lở công khai.',
                status: 'approved',
            },
            {
                email: 'nguyen.van.khanh@gmail.com',
                content:
                    'Cửa Ông bị ảnh hưởng ít hơn do địa hình cao hơn nhưng gió rất mạnh, cây đổ nhiều. Mong bà con lưu ý.',
                status: 'approved',
            },
            {
                email: 'tran.thi.yen@gmail.com',
                content:
                    'Xã Cộng Hòa mưa lớn, bờ kênh dẫn nước vào ruộng bị vỡ. Đề nghị địa phương khắc phục nhanh để bà con kịp vụ mùa.',
                status: 'approved',
            },
            {
                email: 'hoang.thi.hoa@gmail.com',
                content:
                    'Dương Huy mưa 200mm trong một ngày. Trạm đo mưa mới có số liệu chính xác không? Vì cảm giác thực tế còn nhiều hơn vậy.',
                status: 'approved',
            },
            {
                email: 'vu.minh.tuan@gmail.com',
                content:
                    'Sao không có bản đồ ngập real-time để người dân biết đường nào ngập, đường nào còn đi được?',
                status: 'pending',
            },
            {
                email: 'bui.van.long@gmail.com',
                content:
                    'Cảnh báo sớm 48h là tốt nhưng quan trọng là phải có đội ứng cứu cụ thể ở từng phường, chứ cảnh báo xong bỏ mặc dân thì cũng vô nghĩa.',
                status: 'pending',
            },
            {
                email: 'do.thi.thu@gmail.com',
                content:
                    'Năm nào cũng ngập năm nào cũng cảnh báo mà vẫn chưa giải quyết được gốc rễ. Cần đầu tư hệ thống thoát nước đồng bộ.',
                status: 'approved',
            },
            {
                email: 'nguyen.thi.lan@gmail.com',
                content:
                    'Cảm ơn thành phố đã thông báo sớm. Gia đình tôi đã kịp chuyển đồ đạc lên tầng trước khi nước dâng.',
                status: 'approved',
            },
            {
                email: 'truong.thi.nhung@gmail.com',
                content: 'Quảng cáo dịch vụ nào đó không liên quan',
                status: 'rejected',
            },
        ],
    },

    // ── Bài 3: Kết quả quan trắc Q2/2026 ─────────────────────────────────
    {
        newsPrefix: 'Kết quả quan trắc môi trường quý 2',
        moderatorEmail: 'tnmt@campha.gov.vn',
        comments: [
            {
                email: 'nguyen.thi.lan@gmail.com',
                content:
                    'Chỉ số AQI 68 — cũng đỡ hơn tôi tưởng. Nhưng những ngày gió đông nam mùi than bay vào thành phố vẫn rất khó chịu, đặc biệt buổi chiều.',
                status: 'approved',
            },
            {
                email: 'tran.van.hung@gmail.com',
                content:
                    'Nước sông Mông Dương trông đục ngầu thế mà vẫn đạt cột B1 ư? Mong có ảnh/video minh chứng thêm để tin hơn.',
                status: 'approved',
            },
            {
                email: 'le.thi.mai@gmail.com',
                content:
                    'Rất mừng khi môi trường được quan tâm theo dõi bài bản. Đề nghị công bố kết quả định kỳ hàng quý để người dân theo dõi xu hướng.',
                status: 'approved',
            },
            {
                email: 'pham.van.duc@gmail.com',
                content:
                    'Bảng số liệu khá dễ hiểu. Mong lần sau có thêm biểu đồ xu hướng theo thời gian để thấy được môi trường đang cải thiện hay xấu đi.',
                status: 'approved',
            },
            {
                email: 'hoang.thi.hoa@gmail.com',
                content:
                    'Nhiệt độ cực đại 37.2°C ngày nào vậy? Hôm đó tôi nhớ làm ruộng ngoài nắng mà như ở lò nướng, gần 40 độ cơ.',
                status: 'approved',
            },
            {
                email: 'kttv1@campha.gov.vn',
                content:
                    'Báo cáo đầy đủ có ở mục Văn bản báo cáo. Bà con quan tâm có thể tải về xem chi tiết từng thông số tại từng điểm quan trắc.',
                status: 'approved',
            },
            {
                email: 'dinh.van.son@gmail.com',
                content:
                    'Chất lượng không khí khu moong than chắc khác hẳn khu dân cư nhỉ? Mong có số liệu riêng cho khu vực khai thác.',
                status: 'pending',
            },
            {
                email: 'nguyen.van.khanh@gmail.com',
                content:
                    'PM2.5 trung bình 28.4 µg/m³ là dưới ngưỡng QCVN nhưng WHO khuyến nghị chỉ 15 µg/m³. Cần nỗ lực hơn nữa.',
                status: 'approved',
            },
        ],
    },

    // ── Bài 4: Kế hoạch PCTT 2026 ────────────────────────────────────────
    {
        newsPrefix: 'Triển khai kế hoạch phòng chống thiên tai',
        moderatorEmail: 'ubnd@campha.gov.vn',
        comments: [
            {
                email: 'tran.van.hung@gmail.com',
                content:
                    'Năm ngoái diễn tập PCTT ở Quang Hanh nhưng chỉ làm qua loa. Mong năm nay tổ chức thực chất hơn, có huy động người dân tham gia.',
                status: 'approved',
            },
            {
                email: 'le.thi.mai@gmail.com',
                content:
                    'Danh sách hộ dân vùng nguy hiểm đã được lập chưa? Gia đình tôi ở gần bờ sông Mông Dương, không biết có trong danh sách không.',
                status: 'approved',
            },
            {
                email: 'pctt@campha.gov.vn',
                content:
                    'Bà con yên tâm. Phòng PCTT đã lập danh sách và sẽ thông báo đến từng hộ dân qua ban dân phố. Hộ nào chưa nhận được thông tin xin liên hệ số điện thoại đường dây nóng 1800 xxxx.',
                status: 'approved',
            },
            {
                email: 'pham.van.duc@gmail.com',
                content:
                    'Cẩm Thịnh cần được ưu tiên vì nằm giữa hai đồi, mưa lớn là nước từ trên đổ xuống rất nhanh. Nhà tôi bị ngập 3 lần trong 2 năm qua.',
                status: 'approved',
            },
            {
                email: 'do.thi.thu@gmail.com',
                content:
                    'Kế hoạch hay nhưng quan trọng là thực thi. Mong UBND kiểm tra tiến độ và công khai kết quả.',
                status: 'approved',
            },
        ],
    },
];

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
(async () => {
    try {
        let insertedTotal = 0;
        let skippedTotal = 0;
        let moderatedTotal = 0;

        for (const group of COMMENT_DATA) {
            let newsId;
            try {
                newsId = await getNewsId(group.newsPrefix);
            } catch (e) {
                console.warn(`  [SKIP nhóm] ${e.message}`);
                continue;
            }

            const moderatorId = await getUserId(group.moderatorEmail);

            for (const c of group.comments) {
                let userId;
                try {
                    userId = await getUserId(c.email);
                } catch (e) {
                    console.warn(`  [SKIP] ${e.message}`);
                    continue;
                }

                // Idempotent: check bằng (news_id, user_id, content prefix)
                const { rows: exist } = await db.query(
                    `SELECT id FROM cms.news_comments
                     WHERE news_id=$1 AND user_id=$2
                       AND left(content, 40) = left($3, 40)`,
                    [newsId, userId, c.content],
                );
                if (exist[0]) {
                    skippedTotal++;
                    continue;
                }

                // Insert bình luận
                const { rows: ins } = await db.query(
                    `INSERT INTO cms.news_comments(news_id, user_id, content, status)
                     VALUES($1,$2,$3,'pending')
                     RETURNING id`,
                    [newsId, userId, c.content],
                );
                const commentId = ins[0].id;
                insertedTotal++;

                // Duyệt / từ chối nếu không phải pending
                if (c.status !== 'pending') {
                    await db.query(
                        `UPDATE cms.news_comments
                         SET status=$2, moderated_by=$3, moderated_at=NOW() - (random()*interval '2 days')
                         WHERE id=$1`,
                        [commentId, c.status, moderatorId],
                    );
                    moderatedTotal++;
                }

                const icon = c.status === 'approved' ? '✓' : c.status === 'rejected' ? '✗' : '…';
                console.log(`  [${icon}] news#${newsId} | ${c.email.split('@')[0]} — ${c.status}`);
            }
        }

        console.log(`\nSeed bình luận hoàn tất:`);
        console.log(`  Đã thêm  : ${insertedTotal}`);
        console.log(`  Đã duyệt : ${moderatedTotal}`);
        console.log(`  Bỏ qua   : ${skippedTotal}`);

        await db.pool.end();
        process.exit(0);
    } catch (e) {
        console.error('SEED FAILED:', e.message, e.stack);
        await db.pool.end().catch(() => {});
        process.exit(1);
    }
})();
