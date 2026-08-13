/**
 * Seed dữ liệu phản ánh hiện trường (field reports) mẫu cho hệ thống Cẩm Phả.
 * Bao gồm các tình huống ngập lụt, hư hỏng hạ tầng sau mưa lũ tại các phường.
 *
 * Yêu cầu: 001_users + 004_extra_users đã chạy (cần user citizen và ubnd_tp).
 * Idempotent: kiểm tra description trước khi insert.
 *
 * Chạy: node src/database/seeds/003_field_reports.seed.js
 */
'use strict';

require('dotenv').config();

const db = require('../../configs/database');

const CITIZEN_EMAIL = 'citizen@campha.gov.vn';
const UBND_EMAIL    = 'ubnd@campha.gov.vn';

// Người dân từ các phường gửi phản ánh
const SENDERS = {
    quangHanh: 'tran.van.hung@gmail.com',
    mongDuong:  'le.thi.mai@gmail.com',
    camThinh:   'pham.van.duc@gmail.com',
    duongHuy:   'hoang.thi.hoa@gmail.com',
    camPhu:     'nguyen.thi.lan@gmail.com',
    camBinh:    'vu.minh.tuan@gmail.com',
    camTay:     'do.thi.thu@gmail.com',
    camTrung:   'bui.van.long@gmail.com',
    cuaOng:     'nguyen.van.khanh@gmail.com',
    congHoa:    'tran.thi.yen@gmail.com',
    camSon:     'dinh.van.son@gmail.com',
    camDong:    'truong.thi.nhung@gmail.com',
    default:    CITIZEN_EMAIL,
};

// ---------------------------------------------------------------------------
//  Dữ liệu phản ánh mẫu
//  geometry: { lon, lat } — trung tâm vị trí phản ánh
//  status: pending | under_review | approved | rejected | resolved
// ---------------------------------------------------------------------------
const FIELD_REPORTS = [
    // ── Ngập lụt / Thoát nước ─────────────────────────────────────────────
    {
        senderKey: 'quangHanh',
        description:
            'Đường vào tổ 3 phường Quang Hanh bị ngập sâu hơn 80 cm do cống thoát nước bị tắc nghẽn bởi rác và bùn. Xe máy và ô tô không thể đi qua, học sinh bị kẹt không thể đến trường từ sáng sớm.',
        lon: 107.2752,
        lat: 20.9921,
        status: 'approved',
        reviewReason: 'Đã xác minh hiện trường, phân công đơn vị thoát nước xử lý trong 24 giờ.',
    },
    {
        senderKey: 'mongDuong',
        description:
            'Nhà tôi ở khu ven sông Mông Dương, đoạn gần cầu Mông Dương cũ. Nước sông dâng lên rất nhanh sau mưa lớn tối qua, hiện đã tràn vào sân và tầng trệt của nhiều nhà dân trong khu. Mực nước tăng khoảng 1,2 m so với bình thường.',
        lon: 107.3258,
        lat: 21.0437,
        status: 'resolved',
        reviewReason: 'Đã xác minh và triển khai bơm tiêu nước, gia cố bờ kè tạm thời. Tình trạng đã được kiểm soát.',
    },
    {
        senderKey: 'camThinh',
        description:
            'Cống thoát nước chính đầu đường Lê Lợi, phường Cẩm Thịnh (gần ngã tư chợ Cẩm Thịnh) bị vỡ miệng cống, nước mưa không thoát được gây ngập úng khu dân cư xung quanh. Người dân phải kê cao đồ đạc.',
        lon: 107.3071,
        lat: 21.0093,
        status: 'under_review',
        reviewReason: 'Đang xác minh hiện trường và phối hợp với Phòng Hạ tầng Kỹ thuật.',
    },
    {
        senderKey: 'duongHuy',
        description:
            'Suối nhỏ qua khu dân cư tổ 2 phường Dương Huy bị lũ quét, nước cuốn theo đất đá tràn vào đường và sân vườn của 5 hộ dân. Một đoạn taluy đường bị sạt trơ lõi. Tình trạng nguy hiểm, xin hỗ trợ khẩn.',
        lon: 107.2894,
        lat: 21.0302,
        status: 'resolved',
        reviewReason: 'Đã khắc phục khẩn cấp: dọn đất đá, gia cố taluy tạm thời, hỗ trợ 5 hộ dân bị thiệt hại.',
    },
    {
        senderKey: 'camPhu',
        description:
            'Đoạn vỉa hè đường Lê Thánh Tông trước số nhà 47–55, phường Cẩm Phú bị sụt lún nghiêm trọng sau đợt mưa lớn. Gạch lát vỡ vụn, hố sâu khoảng 30 cm lộ ra, rất nguy hiểm cho người đi bộ đặc biệt buổi tối.',
        lon: 107.2953,
        lat: 21.0038,
        status: 'approved',
        reviewReason: 'Đã cắm biển cảnh báo, lên kế hoạch sửa chữa trong tuần tới.',
    },
    {
        senderKey: 'camBinh',
        description:
            'Nắp cống thoát nước trước cổng trường Tiểu học Cẩm Bình bị lật và mất hoàn toàn, tạo ra hố sâu khoảng 60 cm ngay trên vỉa hè. Học sinh đi học rất dễ bị ngã, đặc biệt khi trời mưa và đường trơn.',
        lon: 107.2831,
        lat: 21.0155,
        status: 'resolved',
        reviewReason: 'Đã lắp nắp cống mới, hoàn thành trước giờ học sáng hôm sau.',
    },
    {
        senderKey: 'camTay',
        description:
            'Bờ kè kênh thoát nước phường Cẩm Tây đoạn dài khoảng 20 m bị sạt lở, đất trượt xuống kênh làm giảm tiết diện thoát nước. Lo ngại nếu mưa tiếp tục sẽ gây ngập cho khu dân cư phía sau bờ kè.',
        lon: 107.2989,
        lat: 21.0065,
        status: 'under_review',
        reviewReason: 'Sở Xây dựng đang khảo sát và lập phương án gia cố khẩn cấp.',
    },
    {
        senderKey: 'camTrung',
        description:
            'Đường nội bộ khu dân cư tổ 7 phường Cẩm Trung bị ngập khoảng 40 cm, kết hợp với điện đường bị mất khiến tối hôm qua người dân không thể di chuyển. Đề nghị khẩn cấp bơm nước và kiểm tra điện.',
        lon: 107.3012,
        lat: 21.0047,
        status: 'pending',
        reviewReason: null,
    },

    // ── Sạt lở / Đất đá ──────────────────────────────────────────────────
    {
        senderKey: 'camSon',
        description:
            'Taluy đường từ phường Cẩm Sơn xuống khu công nghiệp bị sạt lở, đất đá đổ ra lấp gần một nửa mặt đường. Xe tải hạng nặng không thể qua, xe máy phải đi len lách rất nguy hiểm. Cần xử lý gấp vì đây là tuyến đường chính.',
        lon: 107.3185,
        lat: 21.0287,
        status: 'approved',
        reviewReason: 'Đã xác minh. Phân công lực lượng dọn đất đá, cắm biển cảnh báo, dự kiến thông đường trong 12 giờ.',
    },
    {
        senderKey: 'cuaOng',
        description:
            'Khu vực đồi phía sau nhà dân tổ 4 phường Cửa Ông có dấu hiệu nứt đất dài khoảng 8 m, chiều rộng khe nứt khoảng 5–10 cm. Sau mưa lớn đêm qua, vết nứt rộng hơn và đất trượt dần xuống. Đề nghị khảo sát ngay vì có 3 hộ dân phía dưới.',
        lon: 107.3541,
        lat: 21.0214,
        status: 'approved',
        reviewReason: 'Đã sơ tán khẩn 3 hộ dân. Địa chất viên Sở TN&MT đang khảo sát đánh giá nguy cơ.',
    },
    {
        senderKey: 'congHoa',
        description:
            'Bờ đê kênh thủy lợi đồng Cộng Hòa bị vỡ một đoạn khoảng 5 m, nước tràn vào ruộng lúa đang giai đoạn trổ bông. Thiệt hại ước tính khoảng 2 ha lúa. Đề nghị hỗ trợ vá đê khẩn cấp để tránh lan rộng thêm.',
        lon: 107.3467,
        lat: 21.0632,
        status: 'resolved',
        reviewReason: 'Đã huy động lực lượng vá đê tạm thời bằng bao cát trong 6 giờ, giữ không cho nước tràn thêm. Lên kế hoạch sửa chữa vĩnh cửu trong tháng tới.',
    },

    // ── Hạ tầng hư hỏng sau lũ ────────────────────────────────────────────
    {
        senderKey: 'camDong',
        description:
            'Cây xanh lớn đổ chắn ngang đường Trần Phú, phường Cẩm Đông sau đêm mưa bão. Cành cây đâm vào dây điện làm đứt 2 dây, gây mất điện cho cả khu. Nguy cơ điện giật rất cao. Đề nghị xử lý khẩn cấp.',
        lon: 107.3024,
        lat: 21.0118,
        status: 'resolved',
        reviewReason: 'Đã cắt điện an toàn, dọn cây trong 3 giờ, điện lực khôi phục nguồn điện sau 8 giờ.',
    },
    {
        senderKey: 'default',
        description:
            'Biển báo giao thông đoạn đường vào cảng than Cẩm Phả bị gió bão thổi đổ, nằm giữa đường gây nguy hiểm cho xe cộ lưu thông. Đã có 1 xe máy bị va vào, may không gây thương tích.',
        lon: 107.3354,
        lat: 21.0178,
        status: 'rejected',
        reviewReason: 'Phản ánh trùng với báo cáo đã tiếp nhận và xử lý trước đó (tham chiếu phản ánh từ cùng vị trí lúc 6:30 sáng).',
    },
];

// ---------------------------------------------------------------------------
//  Helper
// ---------------------------------------------------------------------------
async function getUserId(email) {
    const { rows } = await db.query(
        `SELECT id FROM auth.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
        [email],
    );
    if (!rows[0]) {
        throw new Error(`User không tồn tại: ${email}`);
    }
    return rows[0].id;
}

async function getOrgId(email) {
    const { rows } = await db.query(
        `SELECT org_id FROM auth.users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
        [email],
    );
    if (!rows[0]) {
        throw new Error(`Không tìm được org của user: ${email}`);
    }
    return rows[0].org_id;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
(async () => {
    try {
        const reviewerId = await getUserId(UBND_EMAIL);
        let inserted = 0;
        let skipped = 0;

        for (const r of FIELD_REPORTS) {
            const senderEmail = SENDERS[r.senderKey] || SENDERS.default;
            let senderId;
            try {
                senderId = await getUserId(senderEmail);
            } catch {
                console.warn(`  [SKIP] User không tồn tại: ${senderEmail}`);
                skipped++;
                continue;
            }
            const orgId = await getOrgId(senderEmail);

            // Idempotent: so sánh 60 ký tự đầu của description
            const { rows: exist } = await db.query(
                `SELECT id FROM community.field_reports
                 WHERE sender_user_id = $1
                   AND left(description, 60) = left($2, 60)
                   AND deleted_at IS NULL`,
                [senderId, r.description],
            );
            if (exist[0]) {
                console.log(`  [SKIP] Phản ánh đã tồn tại: "${r.description.substring(0, 50)}..."`);
                skipped++;
                continue;
            }

            // Tạo reference_code dạng CP-YYYYMMDD-XXXX
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const rand  = Math.floor(1000 + Math.random() * 9000);
            const refCode = `CP-${today}-${rand}`;

            // Xác định reviewed_by / reviewed_at / review_reason theo status
            const needsReview = !['pending', 'under_review'].includes(r.status);

            const { rows: ins } = await db.query(
                `INSERT INTO community.field_reports
                    (reference_code, sender_user_id, org_id, description,
                     location, status,
                     review_reason, reviewed_by, reviewed_at,
                     created_at, updated_at)
                 VALUES (
                     $1, $2, $3, $4,
                     ST_SetSRID(ST_MakePoint($5, $6), 4326),
                     $7,
                     $8, $9,
                     CASE WHEN $10 THEN NOW() - (random() * interval '2 days') ELSE NULL END,
                     NOW() - (random() * interval '5 days'),
                     NOW() - (random() * interval '1 day')
                 )
                 RETURNING id, reference_code`,
                [
                    refCode,
                    senderId,
                    orgId,
                    r.description,
                    r.lon,
                    r.lat,
                    r.status,
                    needsReview ? r.reviewReason : null,
                    needsReview ? reviewerId    : null,
                    needsReview,
                ],
            );
            const reportId = ins[0].id;

            // Chèn lịch sử trạng thái
            const transitions = buildTransitions(r.status, reviewerId);
            for (const t of transitions) {
                await db.query(
                    `INSERT INTO community.field_report_status_history
                        (report_id, previous_status, new_status, reason, actor_user_id, created_at)
                     VALUES ($1, $2, $3, $4, $5, NOW() - (random() * interval '3 days'))`,
                    [reportId, t.from, t.to, t.reason, t.actor],
                );
            }

            const icon = { pending: '…', under_review: '◔', approved: '✓', rejected: '✗', resolved: '★' }[r.status] || '?';
            console.log(`  [${icon}] ${r.status.padEnd(12)} | ${ins[0].reference_code} | "${r.description.substring(0, 55)}..."`);
            inserted++;
        }

        console.log(`\nSeed phản ánh hoàn tất:`);
        console.log(`  Đã thêm : ${inserted}`);
        console.log(`  Bỏ qua  : ${skipped}`);

        await db.pool.end();
        process.exit(0);
    } catch (e) {
        console.error('SEED FAILED:', e.message, e.stack);
        await db.pool.end().catch(() => {});
        process.exit(1);
    }
})();

// ---------------------------------------------------------------------------
//  Xây dựng chuỗi lịch sử chuyển trạng thái phù hợp với validate trigger
// ---------------------------------------------------------------------------
function buildTransitions(finalStatus, reviewerId) {
    const reason = {
        under_review: 'Đang xác minh hiện trường.',
        approved:     'Nội dung đã được xác minh, phân công đơn vị xử lý.',
        rejected:     'Phản ánh trùng hoặc không đủ điều kiện tiếp nhận.',
        resolved:     'Đơn vị phụ trách đã hoàn tất xử lý hiện trường.',
    };

    switch (finalStatus) {
        case 'pending':
            return [];
        case 'under_review':
            return [{ from: 'pending', to: 'under_review', reason: reason.under_review, actor: reviewerId }];
        case 'approved':
            return [
                { from: 'pending',      to: 'under_review', reason: reason.under_review, actor: reviewerId },
                { from: 'under_review', to: 'approved',     reason: reason.approved,     actor: reviewerId },
            ];
        case 'rejected':
            return [
                { from: 'pending',      to: 'under_review', reason: reason.under_review, actor: reviewerId },
                { from: 'under_review', to: 'rejected',     reason: reason.rejected,     actor: reviewerId },
            ];
        case 'resolved':
            return [
                { from: 'pending',      to: 'under_review', reason: reason.under_review, actor: reviewerId },
                { from: 'under_review', to: 'approved',     reason: reason.approved,     actor: reviewerId },
                { from: 'approved',     to: 'resolved',     reason: reason.resolved,     actor: reviewerId },
            ];
        default:
            return [];
    }
}
