/**
 * Seed dữ liệu mẫu CMS: tin tức, văn bản báo cáo và bản đồ PDF Cẩm Phả.
 *
 * Yêu cầu: migration 010_cms_content.sql đã chạy; tài khoản admin đã seed (001_users.seed.js).
 * Idempotent: kiểm tra title/code trước khi insert.
 *
 * Chạy: node src/database/seeds/002_cms_content.seed.js
 */
'use strict';

require('dotenv').config();

const db = require('../../configs/database');

const ADMIN_EMAIL = 'admin@campha.gov.vn';
const TNMT_EMAIL = 'tnmt@campha.gov.vn';
const UBND_EMAIL = 'ubnd@campha.gov.vn';

// ---------------------------------------------------------------------------
//  Helper: upsert một file_object placeholder (không có file thật trong MinIO)
// ---------------------------------------------------------------------------
async function ensureFileObject({
    ownerUserId,
    orgId,
    category,
    bucket,
    objectKey,
    originalName,
    mime,
    sizeBytes,
}) {
    const { rows } = await db.query(
        `SELECT id FROM core.file_objects WHERE bucket=$1 AND object_key=$2`,
        [bucket, objectKey],
    );
    if (rows[0]) {
        return rows[0].id;
    }

    const { rows: ins } = await db.query(
        `INSERT INTO core.file_objects
             (category, bucket, object_key, owner_user_id, org_id, original_name,
              expected_mime, detected_mime, size_bytes, sha256,
              scan_status, lifecycle_status, ready_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,
                 lpad('0', 64, '0'),
                 'clean','ready',NOW())
         RETURNING id`,
        [category, bucket, objectKey, ownerUserId, orgId, originalName, mime, sizeBytes],
    );
    return ins[0].id;
}

async function getUser(email) {
    const { rows } = await db.query(
        `SELECT u.id, u.org_id FROM auth.users u WHERE lower(u.email)=lower($1) AND u.deleted_at IS NULL`,
        [email],
    );
    if (!rows[0]) {
        throw new Error(`User not found: ${email}`);
    }
    return rows[0];
}

// ---------------------------------------------------------------------------
//  Tin tức
// ---------------------------------------------------------------------------
const NEWS_ITEMS = [
    {
        title: 'Hệ thống quan trắc khí tượng thủy văn tự động chính thức hoạt động tại Cẩm Phả',
        summary:
            'Ngày 15/01/2026, hệ thống 6 trạm quan trắc KTTV tự động được lắp đặt trên địa bàn thành phố Cẩm Phả chính thức đi vào hoạt động, cung cấp số liệu thời gian thực 24/7.',
        content: `<h2>Cẩm Phả triển khai mạng lưới quan trắc KTTV tự động</h2>
<p>Ngày 15/01/2026, UBND thành phố Cẩm Phả phối hợp cùng Sở Tài nguyên và Môi trường tỉnh Quảng Ninh tổ chức lễ ra mắt hệ thống 6 trạm quan trắc khí tượng thủy văn (KTTV) tự động trải dài trên địa bàn toàn thành phố.</p>
<p>Các trạm được trang bị cảm biến hiện đại đo lường đồng thời nhiều thông số: lượng mưa, mực nước, nhiệt độ, độ ẩm, tốc độ và hướng gió, áp suất khí quyển. Dữ liệu được truyền về trung tâm mỗi 10 phút và hiển thị trực quan trên bản đồ WebGIS.</p>
<h3>Vị trí các trạm</h3>
<ul>
  <li>Trạm Khí tượng Cẩm Phả (trung tâm thành phố)</li>
  <li>Trạm đo mưa Quang Hanh (phường Quang Hanh)</li>
  <li>Trạm đo mực nước Mông Dương (phường Mông Dương)</li>
  <li>Trạm đo mưa Cẩm Thịnh (phường Cẩm Thịnh)</li>
  <li>Trạm thủy triều cảng Cẩm Phả (cảng than Cẩm Phả)</li>
  <li>Trạm đo mưa Dương Huy (phường Dương Huy)</li>
</ul>
<p>Hệ thống cho phép cảnh báo sớm lũ lụt, mưa lớn và các hiện tượng thời tiết cực đoan, hỗ trợ UBND thành phố ra quyết định kịp thời trong công tác phòng chống thiên tai.</p>`,
        visibility: 'public',
        status: 'published',
        authorEmail: ADMIN_EMAIL,
    },
    {
        title: 'Cảnh báo mưa lớn diện rộng tại Cẩm Phả — nguy cơ ngập úng cục bộ',
        summary:
            'Đài Khí tượng Thủy văn tỉnh Quảng Ninh cảnh báo Cẩm Phả có khả năng xảy ra mưa to đến rất to trong 48 giờ tới, tổng lượng mưa có thể đạt 150–250 mm.',
        content: `<h2>Thông báo cảnh báo mưa lớn</h2>
<p><strong>Thời gian:</strong> 06:00 ngày 20/07/2026 – 06:00 ngày 22/07/2026</p>
<p><strong>Khu vực ảnh hưởng:</strong> Toàn bộ địa bàn thành phố Cẩm Phả, đặc biệt các phường Quang Hanh, Mông Dương và Cẩm Thịnh.</p>
<h3>Nội dung cảnh báo</h3>
<p>Do ảnh hưởng của rãnh áp thấp kết hợp hoàn lưu sau bão số 3, khu vực Cẩm Phả có khả năng xảy ra mưa to đến rất to. Tổng lượng mưa phổ biến 150–250 mm, có nơi trên 300 mm trong 48 giờ.</p>
<h3>Nguy cơ</h3>
<ul>
  <li>Ngập úng cục bộ tại các khu vực trũng thấp, ven sông Mông Dương</li>
  <li>Sạt lở đất tại các khu vực đồi núi, bờ moong khai thác than</li>
  <li>Lũ quét ở các suối nhỏ khu vực Quang Hanh, Dương Huy</li>
</ul>
<h3>Khuyến cáo</h3>
<p>UBND thành phố Cẩm Phả khuyến cáo người dân:</p>
<ul>
  <li>Không di chuyển qua các tuyến đường ngập nước</li>
  <li>Sơ tán khỏi khu vực nguy cơ sạt lở cao</li>
  <li>Theo dõi thường xuyên thông tin cảnh báo qua hệ thống quan trắc trực tuyến</li>
</ul>`,
        visibility: 'public',
        status: 'published',
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Kết quả quan trắc môi trường quý 2 năm 2026 — Thành phố Cẩm Phả',
        summary:
            'Tổng hợp kết quả quan trắc chất lượng môi trường không khí, nước mặt và khí hậu trong quý 2/2026 trên địa bàn thành phố Cẩm Phả.',
        content: `<h2>Báo cáo quan trắc môi trường Q2/2026</h2>
<h3>1. Chất lượng không khí</h3>
<p>Chỉ số AQI trung bình quý 2 tại trạm trung tâm Cẩm Phả đạt <strong>68</strong> (mức Trung bình — màu vàng). Nồng độ bụi PM2.5 trung bình 24h là 28,4 µg/m³, dưới ngưỡng QCVN 05:2023/BTNMT.</p>
<h3>2. Khí hậu</h3>
<table border="1" cellpadding="4">
  <tr><th>Thông số</th><th>Giá trị TB</th><th>Cực đại</th><th>Cực tiểu</th></tr>
  <tr><td>Nhiệt độ (°C)</td><td>28,6</td><td>37,2</td><td>20,1</td></tr>
  <tr><td>Độ ẩm (%)</td><td>82</td><td>98</td><td>52</td></tr>
  <tr><td>Lượng mưa (mm)</td><td>380 (cả quý)</td><td>97 (ngày 18/5)</td><td>0</td></tr>
  <tr><td>Tốc độ gió (m/s)</td><td>2,4</td><td>14,8</td><td>0</td></tr>
</table>
<h3>3. Chất lượng nước mặt</h3>
<p>Mẫu nước tại 5 điểm quan trắc trên sông Mông Dương và các hồ điều hòa đều đạt QCVN 08-MT:2023/BTNMT cột B1. Chỉ tiêu pH dao động 6,8–7,4; DO đạt ≥ 5 mg/L.</p>
<p><em>Báo cáo đầy đủ có thể tải từ mục Văn bản báo cáo.</em></p>`,
        visibility: 'public',
        status: 'published',
        authorEmail: TNMT_EMAIL,
    },
    {
        title: 'Triển khai kế hoạch phòng chống thiên tai và tìm kiếm cứu nạn năm 2026',
        summary:
            'UBND thành phố Cẩm Phả ban hành kế hoạch phòng chống thiên tai và tìm kiếm cứu nạn năm 2026, tập trung vào ứng phó mưa lũ, sạt lở và các hiện tượng thời tiết cực đoan.',
        content: `<h2>Kế hoạch phòng chống thiên tai 2026</h2>
<p>Thực hiện Quyết định số 1345/QĐ-UBND ngày 10/01/2026, UBND thành phố Cẩm Phả triển khai kế hoạch phòng chống thiên tai và tìm kiếm cứu nạn (PCTT-TKCN) năm 2026.</p>
<h3>Mục tiêu</h3>
<ul>
  <li>Giảm thiểu thiệt hại do thiên tai gây ra đến mức thấp nhất</li>
  <li>Hoàn thiện hệ thống cảnh báo sớm và thông tin liên lạc</li>
  <li>Nâng cao năng lực ứng phó tại chỗ của cộng đồng</li>
</ul>
<h3>Nhiệm vụ trọng tâm</h3>
<p>Rà soát, cập nhật bản đồ ngập lụt, sạt lở toàn thành phố; lập danh sách hộ dân trong vùng nguy hiểm; tổ chức diễn tập PCTT-TKCN tại 3 phường trọng điểm: Quang Hanh, Mông Dương và Cẩm Thịnh.</p>`,
        visibility: 'internal',
        status: 'published',
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Nâng cấp hệ thống GIS quản lý hạ tầng đô thị Cẩm Phả giai đoạn 2',
        summary:
            'Sở Xây dựng Quảng Ninh khởi động giai đoạn 2 nâng cấp hệ thống GIS tích hợp quản lý hạ tầng kỹ thuật đô thị thành phố Cẩm Phả, bao gồm cấp thoát nước, giao thông và cây xanh.',
        content: `<h2>GIS hạ tầng đô thị Cẩm Phả — Giai đoạn 2</h2>
<p>Sau thành công của giai đoạn 1 (2024–2025), Sở Xây dựng Quảng Ninh tiếp tục triển khai giai đoạn 2 của dự án hệ thống GIS quản lý hạ tầng đô thị thành phố Cẩm Phả.</p>
<h3>Nội dung giai đoạn 2</h3>
<ul>
  <li>Số hóa toàn bộ mạng lưới thoát nước và cống rãnh (độ chính xác ≤ 0,5 m)</li>
  <li>Tích hợp dữ liệu cây xanh đô thị với cơ sở dữ liệu GIS</li>
  <li>Xây dựng module mô phỏng ngập úng nội đô kết nối với hệ thống KTTV</li>
  <li>Triển khai ứng dụng di động cho cán bộ kiểm tra hiện trường</li>
</ul>
<h3>Tiến độ</h3>
<p>Dự kiến hoàn thành Q4/2026. Đơn vị thực hiện: Sở Xây dựng Quảng Ninh phối hợp cùng Phòng Quản lý đô thị thành phố Cẩm Phả.</p>`,
        visibility: 'public',
        status: 'draft',
        authorEmail: ADMIN_EMAIL,
    },
];

// ---------------------------------------------------------------------------
//  Văn bản báo cáo
// ---------------------------------------------------------------------------
const DOCUMENTS = [
    {
        title: 'Báo cáo hiện trạng môi trường thành phố Cẩm Phả năm 2025',
        documentCode: 'BC-HSTMT-2025-CP',
        issuingAgency: 'Sở Tài nguyên và Môi trường Quảng Ninh',
        issuedAt: '2025-12-20',
        description:
            'Báo cáo tổng hợp hiện trạng môi trường không khí, nước mặt, nước ngầm, đất và tiếng ồn trên địa bàn thành phố Cẩm Phả năm 2025. Bao gồm kết quả quan trắc 4 quý, phân tích xu hướng và đề xuất giải pháp cải thiện.',
        visibility: 'public',
        fileName: 'BC-HSTMT-2025-CP.pdf',
        mime: 'application/pdf',
        sizeBytes: 4821200,
        authorEmail: TNMT_EMAIL,
    },
    {
        title: 'Kế hoạch phòng chống thiên tai và tìm kiếm cứu nạn thành phố Cẩm Phả năm 2026',
        documentCode: 'KH-PCTT-2026-CP',
        issuingAgency: 'UBND thành phố Cẩm Phả',
        issuedAt: '2026-01-10',
        description:
            'Kế hoạch chi tiết về công tác phòng chống thiên tai, tìm kiếm và cứu nạn trên địa bàn thành phố Cẩm Phả năm 2026. Bao gồm phân công nhiệm vụ, phương án ứng phó và nguồn lực huy động.',
        visibility: 'public',
        fileName: 'KH-PCTT-2026-CP.pdf',
        mime: 'application/pdf',
        sizeBytes: 2305600,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Quy hoạch sử dụng đất thành phố Cẩm Phả giai đoạn 2021–2030',
        documentCode: 'QH-SDD-2021-2030-CP',
        issuingAgency: 'UBND tỉnh Quảng Ninh',
        issuedAt: '2021-06-15',
        description:
            'Quy hoạch sử dụng đất thành phố Cẩm Phả giai đoạn 2021–2030, tầm nhìn đến năm 2045. Bao gồm các chỉ tiêu phân bổ đất đai, danh mục công trình, dự án và bản đồ quy hoạch kèm theo.',
        visibility: 'public',
        fileName: 'QH-SDD-2021-2030-CamPha.pdf',
        mime: 'application/pdf',
        sizeBytes: 8743500,
        authorEmail: TNMT_EMAIL,
    },
    {
        title: 'Báo cáo kết quả kiểm kê đất đai thành phố Cẩm Phả năm 2024',
        documentCode: 'BC-KKDD-2024-CP',
        issuingAgency: 'UBND thành phố Cẩm Phả',
        issuedAt: '2024-12-31',
        description:
            'Kết quả kiểm kê đất đai toàn thành phố Cẩm Phả năm 2024 theo Chỉ thị 15/CT-TTg. Số liệu thống kê diện tích các loại đất, biến động so với năm 2019 và bản đồ kiểm kê kèm theo.',
        visibility: 'internal',
        fileName: 'BC-KKDD-2024-CP.pdf',
        mime: 'application/pdf',
        sizeBytes: 6120000,
        authorEmail: TNMT_EMAIL,
    },
    {
        title: 'Quy chuẩn kỹ thuật địa phương về chất lượng nước mặt — tỉnh Quảng Ninh',
        documentCode: 'QCKT-NM-QN-2023',
        issuingAgency: 'UBND tỉnh Quảng Ninh',
        issuedAt: '2023-09-01',
        description:
            'Quy chuẩn kỹ thuật địa phương tỉnh Quảng Ninh về chất lượng nước mặt áp dụng cho các vùng đặc thù khai thác than, ban hành theo Quyết định số 2890/QĐ-UBND.',
        visibility: 'public',
        fileName: 'QCKT-NM-QN-2023.pdf',
        mime: 'application/pdf',
        sizeBytes: 1840000,
        authorEmail: TNMT_EMAIL,
    },
    {
        title: 'Báo cáo đánh giá tác động môi trường mỏ than Mông Dương mở rộng',
        documentCode: 'DTM-MONTHUONG-MR-2025',
        issuingAgency: 'Vinacomin — Công ty than Mông Dương',
        issuedAt: '2025-03-20',
        description:
            'Báo cáo đánh giá tác động môi trường (ĐTM) dự án mở rộng khai thác mỏ than Mông Dương giai đoạn 2025–2035. Đã được Bộ TN&MT phê duyệt tại Quyết định 456/QĐ-BTNMT.',
        visibility: 'public',
        fileName: 'DTM-MongDuong-MoRong-2025.pdf',
        mime: 'application/pdf',
        sizeBytes: 12500000,
        authorEmail: TNMT_EMAIL,
    },
];

// ---------------------------------------------------------------------------
//  Bản đồ PDF
// ---------------------------------------------------------------------------
const PDF_MAPS = [
    {
        title: 'Bản đồ lớp phủ trước ngập năm 2015 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2015,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2015 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'truocngap2015.pdf',
        sizeBytes: 1508819,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ sau ngập năm 2015 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2015,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2015 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'saungap2015.pdf',
        sizeBytes: 1551524,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ trước ngập năm 2018 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2018,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2018 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'truocngap2018.pdf',
        sizeBytes: 2146250,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ sau ngập năm 2018 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2018,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2018 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'saungap2018.pdf',
        sizeBytes: 2179368,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ trước ngập năm 2020 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2020,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2020 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'truocngap2020.pdf',
        sizeBytes: 2229484,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ sau ngập năm 2020 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2020,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2020 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'saungap2020.pdf',
        sizeBytes: 2229059,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ trước ngập năm 2022 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2022,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2022 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'truocngap2022.pdf',
        sizeBytes: 2348411,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ sau ngập năm 2022 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2022,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2022 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'saungap2022.pdf',
        sizeBytes: 2279943,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ trước ngập năm 2024 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2024,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2024 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'truocngap2024.pdf',
        sizeBytes: 2257438,
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Bản đồ lớp phủ sau ngập năm 2024 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2024,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description:
            'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2024 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
        fileName: 'saungap2024.pdf',
        sizeBytes: 2362302,
        authorEmail: UBND_EMAIL,
    },
];

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
(async () => {
    try {
        // --- Seed tin tức ---
        let newsCount = 0;
        for (const n of NEWS_ITEMS) {
            const actor = await getUser(n.authorEmail);
            const { rows: exist } = await db.query(
                `SELECT id FROM cms.news WHERE lower(btrim(title))=lower($1) AND deleted_at IS NULL`,
                [n.title],
            );
            if (exist[0]) {
                console.log(`  [SKIP] Tin tức đã tồn tại: "${n.title.substring(0, 60)}..."`);
                continue;
            }
            await db.query(
                `INSERT INTO cms.news(title,summary,content,visibility,status,published_at,created_by,updated_by)
                 VALUES($1,$2,$3,$4,$5::varchar,
                        CASE WHEN $5::varchar='published' THEN NOW() ELSE NULL END,
                        $6,$6)`,
                [n.title, n.summary, n.content, n.visibility, n.status, actor.id],
            );
            console.log(`  [OK]   Tin tức: "${n.title.substring(0, 60)}..."`);
            newsCount++;
        }

        // --- Seed văn bản + file objects ---
        let docCount = 0;
        for (const d of DOCUMENTS) {
            const actor = await getUser(d.authorEmail);
            const { rows: exist } = await db.query(
                `SELECT id FROM cms.documents WHERE lower(document_code)=lower($1) AND deleted_at IS NULL`,
                [d.documentCode],
            );
            if (exist[0]) {
                console.log(`  [SKIP] Văn bản đã tồn tại: ${d.documentCode}`);
                continue;
            }
            const fileId = await ensureFileObject({
                ownerUserId: actor.id,
                orgId: actor.org_id,
                category: 'documents',
                bucket: 'campha-documents',
                objectKey: `seed/documents/${d.documentCode}/${d.fileName}`,
                originalName: d.fileName,
                mime: d.mime,
                sizeBytes: d.sizeBytes,
            });
            await db.query(
                `INSERT INTO cms.documents(title,document_code,issuing_agency,issued_at,description,visibility,file_object_id,created_by)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
                [
                    d.title,
                    d.documentCode,
                    d.issuingAgency,
                    d.issuedAt,
                    d.description,
                    d.visibility,
                    fileId,
                    actor.id,
                ],
            );
            console.log(`  [OK]   Văn bản: ${d.documentCode}`);
            docCount++;
        }

        // --- Seed bản đồ PDF + file objects ---
        let mapCount = 0;
        for (const m of PDF_MAPS) {
            const actor = await getUser(m.authorEmail);
            const objectKey = `seed/pdf-maps/${m.mapYear}/${m.fileName}`;
            const { rows: existFile } = await db.query(
                `SELECT fo.id FROM core.file_objects fo
                 JOIN cms.pdf_maps pm ON pm.file_object_id=fo.id
                 WHERE fo.object_key=$1 AND pm.deleted_at IS NULL`,
                [objectKey],
            );
            if (existFile[0]) {
                console.log(`  [SKIP] Bản đồ PDF đã tồn tại: ${m.fileName}`);
                continue;
            }
            const fileId = await ensureFileObject({
                ownerUserId: actor.id,
                orgId: actor.org_id,
                category: 'documents',
                bucket: 'campha-documents',
                objectKey,
                originalName: m.fileName,
                mime: 'application/pdf',
                sizeBytes: m.sizeBytes,
            });
            await db.query(
                `INSERT INTO cms.pdf_maps(title,scale_label,map_year,preparing_agency,description,visibility,file_object_id,created_by,updated_by)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
                [
                    m.title,
                    m.scaleLabel,
                    m.mapYear,
                    m.preparingAgency,
                    m.description,
                    m.visibility,
                    fileId,
                    actor.id,
                ],
            );
            console.log(`  [OK]   Bản đồ PDF: "${m.title.substring(0, 60)}..."`);
            mapCount++;
        }

        console.log(`\nSeed CMS hoàn tất:`);
        console.log(`  Tin tức mới    : ${newsCount}/${NEWS_ITEMS.length}`);
        console.log(`  Văn bản mới    : ${docCount}/${DOCUMENTS.length}`);
        console.log(`  Bản đồ PDF mới : ${mapCount}/${PDF_MAPS.length}`);

        await db.pool.end();
        process.exit(0);
    } catch (e) {
        console.error('SEED FAILED:', e.message);
        await db.pool.end().catch(() => {});
        process.exit(1);
    }
})();
