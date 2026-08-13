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

    // ── Tin tức ngập lụt Cẩm Phả ─────────────────────────────────────────
    {
        title: 'Thông báo khẩn: Ngập lụt diện rộng tại TP. Cẩm Phả — Người dân cần sơ tán ngay',
        summary:
            'UBND thành phố Cẩm Phả phát thông báo khẩn cấp về tình trạng ngập lụt diện rộng do mưa lớn kéo dài từ ngày 20–22/07/2026. Nhiều khu vực trũng thấp bị ngập sâu từ 0,5 đến 1,5 m.',
        content: `<h2>THÔNG BÁO KHẨN: Ngập lụt diện rộng tại TP. Cẩm Phả</h2>
<p><strong>Ban hành: 21/07/2026 — UBND TP. Cẩm Phả</strong></p>
<p>Do ảnh hưởng của rãnh áp thấp kết hợp hoàn lưu sau bão số 3, từ 22h ngày 20/07/2026 đến nay, mưa rất to đã gây ra tình trạng ngập lụt diện rộng trên địa bàn thành phố Cẩm Phả.</p>
<h3>Các khu vực bị ảnh hưởng nặng</h3>
<ul>
  <li><strong>Phường Quang Hanh:</strong> Ngập từ 0,8–1,2 m tại tổ 3, 4, 5 — gần 200 hộ dân bị ảnh hưởng</li>
  <li><strong>Phường Mông Dương:</strong> Ngập từ 0,5–1,5 m khu vực gần sông Mông Dương</li>
  <li><strong>Phường Cẩm Thịnh:</strong> Ngập úng cục bộ 0,3–0,6 m tại các tuyến đường trũng thấp</li>
  <li><strong>Phường Dương Huy:</strong> Lũ quét qua suối nhỏ, một số tuyến đường bị chia cắt</li>
  <li><strong>Phường Cẩm Phú:</strong> Ngập 0,4–0,7 m tại khu vực chợ và đường Lê Thánh Tông</li>
</ul>
<h3>Lực lượng ứng cứu đã triển khai</h3>
<p>UBND thành phố đã huy động hơn 300 cán bộ, chiến sĩ lực lượng vũ trang và dân quân tự vệ phối hợp cùng Phòng Cảnh sát PCCC&amp;CNCH tổ chức hỗ trợ sơ tán người dân, vật nuôi và tài sản tại các khu vực nguy hiểm.</p>
<h3>Khuyến cáo người dân</h3>
<ul>
  <li>Không di chuyển ra đường khi không cần thiết, đặc biệt trẻ em và người già</li>
  <li>Không lội qua khu vực nước chảy xiết, ngầm tràn đang ngập sâu</li>
  <li>Cắt điện và đưa đồ đạc, thực phẩm lên cao trước khi nước dâng</li>
  <li>Liên hệ đường dây nóng PCTT: <strong>0260 399 9999</strong> khi cần hỗ trợ khẩn cấp</li>
</ul>
<p><em>Thông tin cập nhật liên tục trên Cổng thông tin điện tử TP. Cẩm Phả và kênh quan trắc WebGIS.</em></p>`,
        visibility: 'public',
        status: 'published',
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Tình hình thiệt hại và khắc phục sau đợt ngập lụt tháng 7/2026 tại TP. Cẩm Phả',
        summary:
            'Sau 3 ngày mưa lớn (20–22/07/2026), đợt ngập lụt tháng 7 đã gây thiệt hại đáng kể trên địa bàn TP. Cẩm Phả. Hiện các đơn vị đang tập trung khắc phục hậu quả, dự kiến hoàn thành trước 01/08/2026.',
        content: `<h2>Báo cáo thiệt hại và công tác khắc phục ngập lụt tháng 7/2026</h2>
<p><strong>Cập nhật đến 23:00 ngày 23/07/2026 — UBND TP. Cẩm Phả</strong></p>
<h3>Tổng quan thiệt hại</h3>
<table border="1" cellpadding="4">
  <tr><th>Hạng mục</th><th>Số lượng</th><th>Ghi chú</th></tr>
  <tr><td>Hộ dân bị ngập</td><td>847 hộ</td><td>Tập trung ở Quang Hanh, Mông Dương, Cẩm Thịnh</td></tr>
  <tr><td>Người đã sơ tán</td><td>1.234 người</td><td>Đến các địa điểm tập kết an toàn</td></tr>
  <tr><td>Nhà bị sập/tốc mái</td><td>12 nhà</td><td>Không có thiệt hại về người</td></tr>
  <tr><td>Đường bị chia cắt</td><td>8 tuyến</td><td>Dự kiến thông xe trong 48 giờ</td></tr>
  <tr><td>Diện tích lúa bị hại</td><td>~45 ha</td><td>Xã Cộng Hòa và phường Dương Huy</td></tr>
</table>
<h3>Công tác khắc phục</h3>
<p>Sở Xây dựng Quảng Ninh phối hợp UBND thành phố Cẩm Phả triển khai khắc phục hạ tầng:</p>
<ul>
  <li>Nạo vét và khơi thông 15 tuyến cống thoát nước chính</li>
  <li>Bơm tiêu nước tại 6 điểm ngập sâu khu dân cư</li>
  <li>Sửa chữa khẩn cấp 3 đoạn đường bị lún, sụt sau lũ</li>
  <li>Củng cố và gia cố tạm thời 2 đoạn bờ kè sông Mông Dương bị sạt lở</li>
</ul>
<h3>Hỗ trợ nhân đạo</h3>
<p>UBND thành phố đã phân bổ 500 suất quà hỗ trợ (gồm mì tôm, nước uống, thuốc men) cho các hộ dân bị ảnh hưởng nặng tại 4 phường trọng điểm. Hội Chữ thập đỏ thành phố tổ chức các điểm nấu ăn miễn phí cho người dân vùng ngập.</p>
<p><em>Kết quả quan trắc mực nước thời gian thực có thể xem trên hệ thống WebGIS thành phố.</em></p>`,
        visibility: 'public',
        status: 'published',
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Hướng dẫn người dân ứng phó an toàn khi xảy ra ngập lụt tại TP. Cẩm Phả',
        summary:
            'Hướng dẫn chi tiết các biện pháp ứng phó an toàn trước, trong và sau khi ngập lụt xảy ra, dành cho người dân TP. Cẩm Phả — đặc biệt tại các phường có nguy cơ cao: Quang Hanh, Mông Dương, Cẩm Thịnh.',
        content: `<h2>Hướng dẫn ứng phó ngập lụt — Dành cho người dân TP. Cẩm Phả</h2>
<p><em>Ban hành bởi UBND TP. Cẩm Phả — Ban chỉ huy Phòng chống thiên tai</em></p>
<h3>Trước khi ngập lụt</h3>
<ul>
  <li>Theo dõi bản tin thời tiết, cảnh báo KTTV và thông báo từ chính quyền địa phương</li>
  <li>Chuyển đồ đạc, thực phẩm, thuốc men lên cao; tắt các thiết bị điện tầng dưới</li>
  <li>Chuẩn bị túi đồ khẩn cấp gồm: đèn pin, pin dự phòng, thuốc thiết yếu, giấy tờ tùy thân, tiền mặt</li>
  <li>Liên hệ hàng xóm, đặc biệt người già, người khuyết tật cần hỗ trợ sơ tán</li>
  <li>Biết rõ địa điểm tập kết sơ tán gần nhất tại phường</li>
</ul>
<h3>Trong khi ngập lụt</h3>
<ul>
  <li><strong>Không lội qua nước chảy xiết</strong> — chỉ 15 cm nước chảy đã đủ sức cuốn ngã người lớn</li>
  <li>Không sử dụng điện trong vùng ngập; nếu cần cắt CB tổng từ vị trí cao và khô ráo</li>
  <li>Trẻ em phải mặc áo phao hoặc dụng cụ nổi nếu di chuyển trong vùng ngập</li>
  <li>Gọi đường dây nóng PCTT: <strong>0260 399 9999</strong> hoặc 112 khi cần cứu hộ khẩn cấp</li>
  <li>Không tự ý trở về nhà khi chính quyền chưa thông báo an toàn</li>
</ul>
<h3>Sau khi ngập rút</h3>
<ul>
  <li>Kiểm tra an toàn điện, gas trước khi dùng lại</li>
  <li>Không uống nước lũ, không ăn thực phẩm tiếp xúc với nước lũ</li>
  <li>Vệ sinh nhà cửa, phun khử khuẩn phòng tránh dịch bệnh (tiêu chảy, sốt xuất huyết)</li>
  <li>Phản ánh hư hỏng hạ tầng (đường, cống, điện) qua ứng dụng Phản ánh hiện trường</li>
</ul>
<h3>Liên hệ hỗ trợ</h3>
<ul>
  <li>Đường dây nóng PCTT TP. Cẩm Phả: <strong>0260 399 9999</strong></li>
  <li>Phòng Cảnh sát PCCC &amp; CNCH: <strong>114</strong></li>
  <li>Trung tâm Y tế TP. Cẩm Phả: <strong>0260 386 2049</strong></li>
</ul>`,
        visibility: 'public',
        status: 'published',
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Báo cáo nội bộ: Đánh giá thiệt hại và phương án khắc phục ngập lụt tháng 7/2026',
        summary:
            '[NỘI BỘ] Báo cáo chi tiết đánh giá thiệt hại, phân tích nguyên nhân và phương án khắc phục toàn diện sau đợt ngập lụt ngày 20–22/07/2026 — gửi lãnh đạo thành phố và các đơn vị liên quan.',
        content: `<h2>BÁO CÁO NỘI BỘ: Đánh giá thiệt hại và phương án khắc phục ngập lụt tháng 7/2026</h2>
<p><em>TÀI LIỆU NỘI BỘ — Không phổ biến rộng rãi</em></p>
<p><strong>Ngày báo cáo:</strong> 24/07/2026 | <strong>Đơn vị lập:</strong> Phòng Quản lý Đô thị TP. Cẩm Phả</p>
<h3>I. Phân tích nguyên nhân</h3>
<h4>1. Nguyên nhân khách quan</h4>
<ul>
  <li>Lượng mưa 248 mm trong 24h (ngày 20–21/07) vượt tần suất thiết kế hệ thống thoát nước 50 năm (220 mm/24h)</li>
  <li>Triều cường đạt 1,8 m lúc 03:00 ngày 21/07, kết hợp mưa lớn làm chậm thoát nước</li>
  <li>Bão số 3 trước đó đã làm giảm sức chứa các hồ điều hòa</li>
</ul>
<h4>2. Nguyên nhân chủ quan (cần khắc phục)</h4>
<ul>
  <li>Hệ thống cống thoát nước phường Quang Hanh chưa được nâng cấp theo quy hoạch 2023</li>
  <li>6/15 cống thu nước dọc đường Lê Thánh Tông bị lắng bùn, chỉ hoạt động 40% công suất</li>
  <li>Bơm tiêu nước trạm Cẩm Thịnh hỏng 1/3 máy bơm (chưa sửa từ tháng 5/2026)</li>
  <li>Hệ thống cảnh báo sớm chỉ gửi SMS, chưa tích hợp cảnh báo đẩy qua app di động</li>
</ul>
<h3>II. Thiệt hại chi tiết</h3>
<table border="1" cellpadding="4">
  <tr><th>Khu vực</th><th>Hộ ngập</th><th>Thời gian ngập</th><th>Độ ngập TĐ</th><th>Ước tính thiệt hại</th></tr>
  <tr><td>Quang Hanh (tổ 3–5)</td><td>312 hộ</td><td>18 giờ</td><td>1,2 m</td><td>~1,8 tỷ đồng</td></tr>
  <tr><td>Mông Dương (ven sông)</td><td>287 hộ</td><td>14 giờ</td><td>0,9 m</td><td>~1,2 tỷ đồng</td></tr>
  <tr><td>Cẩm Thịnh (khu trũng)</td><td>181 hộ</td><td>10 giờ</td><td>0,5 m</td><td>~650 triệu đồng</td></tr>
  <tr><td>Cẩm Phú (khu chợ)</td><td>67 hộ</td><td>6 giờ</td><td>0,4 m</td><td>~320 triệu đồng</td></tr>
  <tr><td>Các phường khác</td><td>~200 hộ</td><td>4–8 giờ</td><td>0,3 m</td><td>~400 triệu đồng</td></tr>
  <tr><td><strong>Tổng cộng</strong></td><td><strong>~1.047 hộ</strong></td><td>—</td><td>—</td><td><strong>~4,35 tỷ đồng</strong></td></tr>
</table>
<h3>III. Phương án khắc phục và đầu tư dài hạn</h3>
<ol>
  <li><strong>Ngắn hạn (trước 30/08/2026):</strong> Nạo vét toàn bộ hệ thống cống chính; sửa chữa bơm tiêu nước Cẩm Thịnh; gia cố bờ kè Mông Dương tại 2 điểm sạt lở.</li>
  <li><strong>Trung hạn (Q4/2026–Q1/2027):</strong> Lập dự án nâng cấp cống thoát nước Quang Hanh (dự kiến 45 tỷ đồng); xây dựng thêm 2 hồ điều hòa tại khu vực phía Đông.</li>
  <li><strong>Dài hạn (2027–2030):</strong> Rà soát toàn bộ quy hoạch thoát nước theo kịch bản biến đổi khí hậu; tích hợp mô hình ngập lụt với hệ thống GIS và cảnh báo sớm đa kênh.</li>
</ol>
<h3>IV. Kiến nghị</h3>
<p>Phòng Quản lý Đô thị kiến nghị UBND thành phố phê duyệt ngân sách bổ sung 8 tỷ đồng từ Quỹ dự phòng thiên tai cho các hạng mục khắc phục khẩn cấp nêu trên.</p>`,
        visibility: 'internal',
        status: 'published',
        authorEmail: UBND_EMAIL,
    },
    {
        title: 'Phương án huy động và điều phối lực lượng ứng cứu ngập lụt — Tài liệu chỉ đạo nội bộ',
        summary:
            '[NỘI BỘ] Phương án chi tiết phân công nhiệm vụ, điều phối lực lượng và phương tiện ứng cứu khi xảy ra ngập lụt trên địa bàn TP. Cẩm Phả — dành cho Ban chỉ huy PCTT và các đơn vị phối hợp.',
        content: `<h2>PHƯƠNG ÁN HUY ĐỘNG VÀ ĐIỀU PHỐI LỰC LƯỢNG ỨNG CỨU NGẬP LỤT</h2>
<p><em>TÀI LIỆU NỘI BỘ — Ban chỉ huy PCTT TP. Cẩm Phả — Cập nhật 25/07/2026</em></p>
<h3>I. Phân cấp báo động</h3>
<table border="1" cellpadding="4">
  <tr><th>Cấp báo động</th><th>Tiêu chí kích hoạt</th><th>Lực lượng huy động</th></tr>
  <tr><td><strong>Cấp 1 (Theo dõi)</strong></td><td>Mưa ≥ 50 mm/6h hoặc mực nước vượt 65% ngưỡng báo động</td><td>Trực ban PCTT; kiểm tra đường dây nóng</td></tr>
  <tr><td><strong>Cấp 2 (Sẵn sàng)</strong></td><td>Mưa ≥ 100 mm/12h hoặc mực nước đạt ngưỡng báo động 1</td><td>Tất cả lực lượng PCTT sẵn sàng; thông báo qua SMS</td></tr>
  <tr><td><strong>Cấp 3 (Ứng cứu)</strong></td><td>Ngập ≥ 0,3 m tại điểm quan trắc hoặc báo động 2 kích hoạt</td><td>Huy động toàn bộ: dân quân, quân sự, PCCC, y tế</td></tr>
  <tr><td><strong>Cấp 4 (Khẩn cấp)</strong></td><td>Ngập ≥ 1 m hoặc có nguy cơ sạt lở nghiêm trọng</td><td>Huy động lực lượng Quân khu 3; yêu cầu hỗ trợ tỉnh</td></tr>
</table>
<h3>II. Phân công nhiệm vụ cụ thể</h3>
<h4>Ban chỉ huy PCTT thành phố</h4>
<ul>
  <li>Chỉ huy toàn diện; phê duyệt cấp báo động; liên lạc với tỉnh và trung ương</li>
  <li>Phụ trách: Trưởng ban — Chủ tịch UBND TP.; Phó ban — Phó Chủ tịch phụ trách đô thị</li>
</ul>
<h4>Phòng Cảnh sát PCCC &amp; CNCH Cẩm Phả</h4>
<ul>
  <li>Tìm kiếm, cứu hộ người bị mắc kẹt; trang bị xuồng máy, thang chữa cháy</li>
  <li>Phụ trách 4 điểm nóng: Quang Hanh tổ 3, Mông Dương ven sông, Cẩm Thịnh khu trũng, Cửa Ông phía bắc</li>
</ul>
<h4>Lực lượng dân quân và quân sự địa phương</h4>
<ul>
  <li>Hỗ trợ sơ tán người dân; tổ chức chốt chặn tại 12 điểm ngập trọng điểm</li>
  <li>Huy động tối đa 400 người khi kích hoạt Cấp 3</li>
</ul>
<h4>Trung tâm Y tế TP. Cẩm Phả</h4>
<ul>
  <li>Lập 4 trạm y tế lưu động tại các điểm tập kết sơ tán; dự phòng thuốc kháng sinh, bù nước, chống rắn cắn</li>
</ul>
<h3>III. Liên lạc và thông tin</h3>
<ul>
  <li>Kênh chính: Radio VHF kênh 7 (tần số 156,350 MHz)</li>
  <li>Báo cáo tình hình: mỗi 2 giờ một lần qua hệ thống GIS thời gian thực</li>
</ul>
<h3>IV. Địa điểm tập kết sơ tán</h3>
<ul>
  <li>Trường THPT Cẩm Phả: tối đa 800 người</li>
  <li>Trường THCS Mông Dương: tối đa 500 người</li>
  <li>Nhà văn hóa Quang Hanh: tối đa 300 người</li>
  <li>Trụ sở UBND phường Cẩm Thịnh: tối đa 200 người</li>
</ul>`,
        visibility: 'internal',
        status: 'published',
        authorEmail: UBND_EMAIL,
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
