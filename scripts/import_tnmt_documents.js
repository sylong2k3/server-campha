'use strict';

/**
 * Import dữ liệu Văn bản (cms.documents) qua REST API bằng tài khoản Sở Tài nguyên
 * và Môi trường (role `so_tnmt`).
 *
 * Luồng cho mỗi văn bản:
 *   1. POST /auth/login                 — lấy accessToken của tnmt@campha.gov.vn
 *   2. GET  /admin/cms/documents        — đọc documentCode đã có để bỏ qua (idempotent)
 *   3. Sinh file PDF mẫu ngay trong bộ nhớ (không cần file nguồn trên đĩa)
 *   4. POST /storage/uploads            — direct upload, trả về fileObjectId (ready/clean)
 *   5. POST /admin/cms/documents        — tạo bản ghi văn bản với fileObjectId ở trên
 *
 * Script chỉ THÊM, không xóa hoặc sửa dữ liệu sẵn có.
 *
 * Chạy:
 *   node scripts/import_tnmt_documents.js            # import thật
 *   node scripts/import_tnmt_documents.js --dry-run  # chỉ liệt kê, không ghi
 *
 * Biến môi trường (tùy chọn):
 *   API_REMOTE_URL  — mặc định https://apicampha.tourismpj.pro.vn/api/v1
 *   TNMT_EMAIL      — mặc định tnmt@campha.gov.vn
 *   TNMT_PASSWORD   — mặc định CamPha@2026
 */

require('dotenv').config();

const API_BASE = (
    process.env.API_REMOTE_URL || 'https://apicampha.tourismpj.pro.vn/api/v1'
).replace(/\/+$/, '');
const TNMT_EMAIL = process.env.TNMT_EMAIL || 'tnmt@campha.gov.vn';
const TNMT_PASSWORD = process.env.TNMT_PASSWORD || 'CamPha@2026';
const DRY_RUN = process.argv.includes('--dry-run');

const AGENCY_TNMT = 'Sở Tài nguyên và Môi trường Quảng Ninh';

// ---------------------------------------------------------------------------
//  Danh mục văn bản do Sở TN&MT ban hành / chủ trì
// ---------------------------------------------------------------------------
const DOCUMENTS = [
    {
        title: 'Quyết định phê duyệt Kế hoạch quan trắc môi trường tỉnh Quảng Ninh năm 2026',
        documentCode: 'QD-2114-STNMT-2026',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-01-15',
        visibility: 'public',
        description:
            'Phê duyệt mạng lưới, tần suất và thông số quan trắc môi trường không khí, nước mặt, nước ngầm và đất trên địa bàn tỉnh Quảng Ninh năm 2026, trong đó thành phố Cẩm Phả có 14 điểm quan trắc định kỳ.',
        body: [
            'Căn cứ Luật Bảo vệ môi trường số 72/2020/QH14 ngày 17/11/2020;',
            'Căn cứ Thông tư 10/2021/TT-BTNMT quy định kỹ thuật quan trắc môi trường;',
            'Xét đề nghị của Chi cục Bảo vệ môi trường tại Tờ trình số 88/TTr-CCBVMT ngày 05/01/2026,',
            'Điều 1. Phê duyệt Kế hoạch quan trắc môi trường tỉnh Quảng Ninh năm 2026 với 96 điểm quan trắc, trong đó địa bàn thành phố Cẩm Phả gồm 14 điểm: 5 điểm không khí, 6 điểm nước mặt và 3 điểm nước dưới đất.',
            'Điều 2. Tần suất quan trắc: không khí 6 đợt/năm; nước mặt 6 đợt/năm; nước dưới đất 4 đợt/năm. Kết quả được công bố trên Cổng thông tin WebGIS Cẩm Phả sau mỗi đợt không quá 15 ngày làm việc.',
            'Điều 3. Chi cục Bảo vệ môi trường chủ trì, phối hợp UBND thành phố Cẩm Phả tổ chức thực hiện; kinh phí bố trí từ nguồn sự nghiệp môi trường năm 2026.',
        ],
    },
    {
        title: 'Báo cáo kết quả quan trắc môi trường quý I năm 2026 — thành phố Cẩm Phả',
        documentCode: 'BC-QTMT-Q1-2026-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-04-10',
        visibility: 'public',
        description:
            'Tổng hợp kết quả quan trắc chất lượng không khí, nước mặt và nước dưới đất quý I/2026 tại 14 điểm trên địa bàn thành phố Cẩm Phả, đối chiếu QCVN hiện hành.',
        body: [
            '1. Chất lượng không khí: AQI trung bình quý đạt 62 (mức Trung bình). Nồng độ bụi PM2.5 trung bình 24h là 26,8 µg/m3, PM10 là 54,1 µg/m3, đều dưới ngưỡng QCVN 05:2023/BTNMT.',
            '2. Nước mặt: 6/6 điểm quan trắc trên sông Mông Dương và các hồ điều hòa đạt QCVN 08-MT:2023/BTNMT cột B1. pH dao động 6,9–7,5; DO đạt 5,2–6,8 mg/L; TSS trung bình 32 mg/L.',
            '3. Nước dưới đất: 3/3 điểm đạt QCVN 09-MT:2023/BTNMT. Không phát hiện vượt ngưỡng kim loại nặng (As, Pb, Cd, Hg).',
            '4. Khuyến nghị: tăng cường kiểm soát bụi tại tuyến vận chuyển than khu vực phường Quang Hanh và Mông Dương trong mùa khô.',
        ],
    },
    {
        title: 'Báo cáo kết quả quan trắc môi trường quý II năm 2026 — thành phố Cẩm Phả',
        documentCode: 'BC-QTMT-Q2-2026-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-07-12',
        visibility: 'public',
        description:
            'Tổng hợp kết quả quan trắc chất lượng không khí, nước mặt và nước dưới đất quý II/2026 tại 14 điểm trên địa bàn thành phố Cẩm Phả, kèm phân tích xu hướng so với quý I.',
        body: [
            '1. Chất lượng không khí: AQI trung bình quý đạt 68 (mức Trung bình), tăng nhẹ so với quý I. PM2.5 trung bình 24h là 28,4 µg/m3, vẫn dưới ngưỡng QCVN 05:2023/BTNMT.',
            '2. Nước mặt: các chỉ tiêu pH 6,8–7,4; DO lớn hơn hoặc bằng 5 mg/L; COD trung bình 18 mg/L. Toàn bộ 6 điểm đạt QCVN 08-MT:2023/BTNMT cột B1.',
            '3. Nước dưới đất: chất lượng ổn định, không có biến động bất thường so với quý I/2026.',
            '4. Ghi nhận: mưa lớn cuối tháng 6 làm tăng độ đục nước mặt cục bộ tại điểm NM-04 (hạ lưu sông Mông Dương), trở lại bình thường sau 7 ngày.',
        ],
    },
    {
        title: 'Hướng dẫn lập báo cáo công tác bảo vệ môi trường định kỳ đối với cơ sở sản xuất trên địa bàn thành phố Cẩm Phả',
        documentCode: 'HD-BVMT-2026-01-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-02-20',
        visibility: 'public',
        description:
            'Hướng dẫn biểu mẫu, nội dung và thời hạn nộp báo cáo công tác bảo vệ môi trường định kỳ theo Thông tư 02/2022/TT-BTNMT cho các cơ sở sản xuất, kinh doanh trên địa bàn thành phố Cẩm Phả.',
        body: [
            'I. Đối tượng áp dụng: các cơ sở sản xuất, kinh doanh, dịch vụ có giấy phép môi trường hoặc đăng ký môi trường trên địa bàn thành phố Cẩm Phả.',
            'II. Thời hạn nộp: trước ngày 05/01 hằng năm cho kỳ báo cáo của năm trước liền kề.',
            'III. Hình thức nộp: bản điện tử qua hệ thống một cửa của Sở Tài nguyên và Môi trường, đồng thời gửi bản giấy về Phòng Tài nguyên và Môi trường thành phố Cẩm Phả.',
            'IV. Nội dung tối thiểu: kết quả quan trắc chất thải, khối lượng chất thải rắn và chất thải nguy hại phát sinh, tình hình vận hành công trình xử lý, các sự cố môi trường (nếu có).',
            'V. Cơ sở không nộp hoặc nộp không đầy đủ sẽ bị xử lý theo Nghị định 45/2022/NĐ-CP.',
        ],
    },
    {
        title: 'Báo cáo hiện trạng khai thác, sử dụng tài nguyên nước mặt thành phố Cẩm Phả năm 2025',
        documentCode: 'BC-TNN-2025-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2025-11-28',
        visibility: 'internal',
        description:
            'Đánh giá trữ lượng, hiện trạng khai thác và cân bằng nước mặt các lưu vực trên địa bàn thành phố Cẩm Phả năm 2025, phục vụ công tác cấp phép tài nguyên nước.',
        body: [
            '1. Tổng lượng nước mặt khai thác năm 2025 trên địa bàn ước đạt 41,6 triệu m3, trong đó cấp nước sinh hoạt chiếm 58%, sản xuất công nghiệp và tuyển than chiếm 37%.',
            '2. Có 23 công trình khai thác được cấp phép; 4 công trình hết hạn giấy phép trong quý IV/2025 cần làm thủ tục gia hạn.',
            '3. Cân bằng nước: mùa khô (tháng 11 đến tháng 4) thiếu hụt cục bộ tại lưu vực suối Dương Huy, mức thiếu ước tính 8–12% nhu cầu.',
            '4. Kiến nghị: rà soát hạn ngạch khai thác mùa khô và bổ sung 2 trạm đo lưu lượng tự động tại thượng nguồn sông Mông Dương.',
        ],
    },
    {
        title: 'Kế hoạch ứng phó sự cố môi trường trên địa bàn thành phố Cẩm Phả năm 2026',
        documentCode: 'KH-UPSCMT-2026-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-03-05',
        visibility: 'public',
        description:
            'Kế hoạch phân công lực lượng, phương tiện và quy trình ứng phó các tình huống sự cố môi trường (tràn dầu, vỡ đập thải, rò rỉ hóa chất, sạt lở bãi thải) trên địa bàn thành phố Cẩm Phả năm 2026.',
        body: [
            'I. Các tình huống giả định: tràn dầu khu vực cảng Cẩm Phả; vỡ đập chứa bùn thải tuyển than; rò rỉ hóa chất tại kho công nghiệp; sạt lở bãi thải mỏ trong mùa mưa.',
            'II. Nguyên tắc ứng phó: bốn tại chỗ (chỉ huy tại chỗ, lực lượng tại chỗ, phương tiện tại chỗ, hậu cần tại chỗ); ưu tiên bảo vệ tính mạng người dân và nguồn nước sinh hoạt.',
            'III. Phân công: Sở Tài nguyên và Môi trường chủ trì quan trắc, đánh giá mức độ ô nhiễm; UBND thành phố Cẩm Phả chỉ đạo sơ tán và bảo đảm an sinh; các đơn vị khai thác chịu trách nhiệm khắc phục tại nguồn.',
            'IV. Chế độ thông tin: báo cáo nhanh trong vòng 2 giờ kể từ khi phát hiện sự cố; cập nhật vùng ảnh hưởng lên hệ thống WebGIS trong 24 giờ.',
        ],
    },
    {
        title: 'Báo cáo công tác quản lý chất thải rắn sinh hoạt thành phố Cẩm Phả năm 2025',
        documentCode: 'BC-CTRSH-2025-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-01-25',
        visibility: 'public',
        description:
            'Đánh giá khối lượng phát sinh, tỷ lệ thu gom, xử lý và phân loại tại nguồn đối với chất thải rắn sinh hoạt trên địa bàn thành phố Cẩm Phả năm 2025.',
        body: [
            '1. Khối lượng phát sinh trung bình 268 tấn/ngày, tăng 4,2% so với năm 2024.',
            '2. Tỷ lệ thu gom khu vực đô thị đạt 98,1%; khu vực nông thôn, vùng ven đạt 87,6%.',
            '3. Phương thức xử lý: chôn lấp hợp vệ sinh 62%, đốt thu hồi nhiệt 31%, tái chế 7%.',
            '4. Phân loại tại nguồn đã triển khai tại 9/16 phường; mục tiêu năm 2026 phủ toàn bộ các phường nội thị.',
            '5. Tồn tại: một số điểm tập kết tự phát ven Quốc lộ 18 gây mất mỹ quan và nguy cơ ô nhiễm nước mặt khi mưa lớn.',
        ],
    },
    {
        title: 'Danh mục khu vực cấm, tạm thời cấm hoạt động khoáng sản trên địa bàn thành phố Cẩm Phả',
        documentCode: 'DM-KVCK-2026-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-05-18',
        visibility: 'internal',
        description:
            'Danh mục và ranh giới các khu vực cấm, tạm thời cấm hoạt động khoáng sản trên địa bàn thành phố Cẩm Phả, kèm tọa độ khép góc phục vụ cập nhật lớp dữ liệu GIS.',
        body: [
            'I. Khu vực cấm hoạt động khoáng sản: hành lang bảo vệ nguồn nước sinh hoạt; khu vực di tích lịch sử — văn hóa đã xếp hạng; hành lang an toàn công trình giao thông và lưới điện cao áp.',
            'II. Khu vực tạm thời cấm: các khu vực có nguy cơ sạt lở cao trong mùa mưa đã được khoanh định tại bản đồ nguy cơ trượt lở tỷ lệ 1:10.000.',
            'III. Tổng số khu vực khoanh định: 27 khu vực, tổng diện tích 1.842,6 ha.',
            'IV. Tọa độ khép góc lập theo hệ VN-2000, kinh tuyến trục 107 độ 45 phút, múi chiếu 3 độ; dữ liệu số kèm theo dạng shapefile để cập nhật vào hệ thống WebGIS.',
        ],
    },
    {
        title: 'Báo cáo hiện trạng đa dạng sinh học và rừng ngập mặn ven biển thành phố Cẩm Phả năm 2025',
        documentCode: 'BC-DDSH-2025-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2025-10-30',
        visibility: 'public',
        description:
            'Kết quả điều tra hiện trạng đa dạng sinh học, diện tích và chất lượng rừng ngập mặn ven biển thành phố Cẩm Phả năm 2025, kèm đề xuất giải pháp phục hồi.',
        body: [
            '1. Diện tích rừng ngập mặn hiện còn 612,4 ha, giảm 3,8% so với kỳ điều tra năm 2020, chủ yếu do lấn biển và nuôi trồng thủy sản.',
            '2. Ghi nhận 148 loài thực vật bậc cao, 96 loài chim (trong đó 4 loài nằm trong Sách đỏ Việt Nam), 74 loài động vật đáy.',
            '3. Chất lượng rừng: 41% diện tích ở mức tốt, 38% trung bình, 21% suy thoái cần phục hồi.',
            '4. Đề xuất: trồng bổ sung 45 ha giai đoạn 2026–2028 tại khu vực phường Cẩm Thịnh và Quang Hanh; thiết lập lớp giám sát biến động rừng ngập mặn bằng ảnh vệ tinh trên hệ thống WebGIS.',
        ],
    },
    {
        title: 'Quyết định phê duyệt phạm vi vùng bảo hộ vệ sinh khu vực lấy nước sinh hoạt thành phố Cẩm Phả',
        documentCode: 'QD-VBHVS-2026-CP',
        issuingAgency: AGENCY_TNMT,
        issuedAt: '2026-06-08',
        visibility: 'public',
        description:
            'Phê duyệt phạm vi vùng bảo hộ vệ sinh của các công trình khai thác nước mặt, nước dưới đất phục vụ cấp nước sinh hoạt trên địa bàn thành phố Cẩm Phả.',
        body: [
            'Điều 1. Phê duyệt phạm vi vùng bảo hộ vệ sinh khu vực lấy nước sinh hoạt đối với 9 công trình khai thác trên địa bàn thành phố Cẩm Phả theo Nghị định 53/2024/NĐ-CP.',
            'Điều 2. Phạm vi vùng bảo hộ: công trình khai thác nước mặt từ 100 m đến 1.000 m tính từ điểm lấy nước về phía thượng lưu; công trình khai thác nước dưới đất bán kính từ 20 m đến 30 m tính từ miệng giếng.',
            'Điều 3. Nghiêm cấm xả nước thải chưa qua xử lý, chôn lấp chất thải, chăn nuôi tập trung trong phạm vi vùng bảo hộ vệ sinh đã phê duyệt.',
            'Điều 4. Đơn vị cấp nước có trách nhiệm cắm mốc, công bố phạm vi vùng bảo hộ và cập nhật ranh giới lên hệ thống bản đồ WebGIS thành phố trong quý III/2026.',
        ],
    },
];

// ---------------------------------------------------------------------------
//  Sinh file PDF mẫu (không phụ thuộc thư viện ngoài)
// ---------------------------------------------------------------------------

/** Bỏ dấu tiếng Việt để in được bằng font chuẩn Helvetica/WinAnsi. */
const deaccent = (text) =>
    text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/[–—]/g, '-')
        .replace(/[^\x20-\x7e]/g, '');

const escapePdfText = (text) =>
    text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const wrap = (text, maxChars) => {
    const out = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
        if (!line.length) {
            line = word;
        } else if (line.length + 1 + word.length <= maxChars) {
            line += ` ${word}`;
        } else {
            out.push(line);
            line = word;
        }
    }
    if (line.length) {
        out.push(line);
    }
    return out;
};

/** Trả về Buffer PDF 1 trang A4 mô tả nội dung văn bản. */
const buildSamplePdf = (doc) => {
    const lines = [];
    const push = (text, font, size, leading) =>
        lines.push({ text: deaccent(text), font, size, leading });

    push(doc.issuingAgency.toUpperCase(), 'F2', 11, 16);
    push('CONG HOA XA HOI CHU NGHIA VIET NAM', 'F2', 11, 14);
    push('Doc lap - Tu do - Hanh phuc', 'F1', 10, 22);
    push(`So: ${doc.documentCode}`, 'F1', 10, 22);
    for (const chunk of wrap(doc.title, 62)) {
        push(chunk, 'F2', 13, 18);
    }
    push(`Ngay ban hanh: ${doc.issuedAt}`, 'F1', 10, 12);
    push(`Pham vi: ${doc.visibility === 'public' ? 'Cong khai' : 'Noi bo'}`, 'F1', 10, 20);
    for (const paragraph of doc.body) {
        for (const chunk of wrap(paragraph, 92)) {
            push(chunk, 'F1', 10, 14);
        }
        push('', 'F1', 10, 8);
    }
    push('(Tai lieu mau phuc vu kiem thu he thong WebGIS Cam Pha.)', 'F1', 9, 12);

    const parts = ['BT'];
    let y = 800;
    for (const line of lines) {
        if (line.text.length) {
            parts.push(`/${line.font} ${line.size} Tf`);
            parts.push(`1 0 0 1 50 ${y.toFixed(2)} Tm`);
            parts.push(`(${escapePdfText(line.text)}) Tj`);
        }
        y -= line.leading;
    }
    parts.push('ET');
    const stream = parts.join('\n');

    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] '
            + '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, index) => {
        offsets.push(Buffer.byteLength(pdf, 'latin1'));
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
        pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'latin1');
};

const safeFileName = (documentCode) =>
    `${deaccent(documentCode).replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;

// ---------------------------------------------------------------------------
//  HTTP helper
// ---------------------------------------------------------------------------
const call = async (path, options = {}) => {
    const response = await fetch(`${API_BASE}${path}`, options);
    const raw = await response.text();
    let body;
    try {
        body = raw ? JSON.parse(raw) : {};
    } catch {
        body = { raw };
    }
    return { httpStatus: response.status, body };
};

const login = async () => {
    const { httpStatus, body } = await call('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TNMT_EMAIL, password: TNMT_PASSWORD }),
    });
    const token = body?.data?.accessToken;
    if (!token) {
        throw new Error(`Đăng nhập thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
    }
    return { token, user: body.data.user || {} };
};

const fetchExistingCodes = async (token) => {
    const codes = new Set();
    for (let page = 1; page <= 20; page += 1) {
        const { httpStatus, body } = await call(`/admin/cms/documents?page=${page}&limit=100`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (httpStatus !== 200) {
            throw new Error(
                `Không đọc được danh sách văn bản (HTTP ${httpStatus}): ${JSON.stringify(body)}`,
            );
        }
        const items = body?.data?.items || [];
        for (const item of items) {
            const code = item.document_code || item.documentCode;
            if (code) {
                codes.add(code.toLowerCase());
            }
        }
        if (items.length < 100) {
            break;
        }
    }
    return codes;
};

const uploadPdf = async (token, fileName, buffer) => {
    const { httpStatus, body } = await call('/storage/uploads', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'x-file-category': 'documents',
            'x-file-name': fileName,
            'content-type': 'application/pdf',
            'content-length': String(buffer.length),
        },
        body: buffer,
    });
    const id = Number(body?.data?.id);
    if (httpStatus !== 201 || !Number.isInteger(id) || id <= 0) {
        throw new Error(
            `Upload "${fileName}" thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`,
        );
    }
    return id;
};

const createDocument = async (token, doc, fileObjectId) => {
    const { httpStatus, body } = await call('/admin/cms/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: doc.title,
            documentCode: doc.documentCode,
            issuingAgency: doc.issuingAgency,
            issuedAt: doc.issuedAt,
            description: doc.description,
            visibility: doc.visibility,
            fileObjectId,
        }),
    });
    if (httpStatus !== 201) {
        throw new Error(
            `Tạo văn bản "${doc.documentCode}" thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`,
        );
    }
    return body.data;
};

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
async function main() {
    console.log('=== IMPORT VĂN BẢN QUA ROLE SỞ TÀI NGUYÊN VÀ MÔI TRƯỜNG ===');
    console.log(`API       : ${API_BASE}`);
    console.log(`Tài khoản : ${TNMT_EMAIL}`);
    console.log(`Chế độ    : ${DRY_RUN ? 'DRY-RUN (không ghi dữ liệu)' : 'GHI DỮ LIỆU THẬT'}\n`);

    console.log('1. Đăng nhập...');
    const { token, user } = await login();
    const roleCode = user.role?.code || user.role_code || user.role || 'n/a';
    console.log(` -> OK. role = ${roleCode}\n`);

    console.log('2. Đọc danh sách văn bản hiện có...');
    const existingCodes = await fetchExistingCodes(token);
    console.log(` -> Hệ thống đang có ${existingCodes.size} văn bản.\n`);

    const pending = DOCUMENTS.filter((d) => !existingCodes.has(d.documentCode.toLowerCase()));
    const skipped = DOCUMENTS.length - pending.length;
    console.log(
        `3. Cần thêm ${pending.length}/${DOCUMENTS.length} văn bản (bỏ qua ${skipped} mã đã tồn tại).\n`,
    );

    if (DRY_RUN) {
        pending.forEach((d, i) => {
            const pdf = buildSamplePdf(d);
            console.log(
                `  [${i + 1}] ${d.documentCode} — ${d.title} (${d.visibility}, PDF mẫu ${(pdf.length / 1024).toFixed(1)} KB)`,
            );
        });
        console.log('\nDRY-RUN kết thúc, không có dữ liệu nào được ghi.');
        return;
    }

    const created = [];
    const failed = [];
    for (let i = 0; i < pending.length; i += 1) {
        const doc = pending[i];
        const label = `[${i + 1}/${pending.length}] ${doc.documentCode}`;
        try {
            const fileName = safeFileName(doc.documentCode);
            const pdf = buildSamplePdf(doc);
            console.log(`${label} tải lên "${fileName}" (${(pdf.length / 1024).toFixed(1)} KB)...`);
            const fileObjectId = await uploadPdf(token, fileName, pdf);
            const row = await createDocument(token, doc, fileObjectId);
            console.log(` -> OK. documentId=${row.id}, fileObjectId=${fileObjectId}`);
            created.push(row);
        } catch (error) {
            console.error(` -> LỖI: ${error.message}`);
            failed.push({ code: doc.documentCode, error: error.message });
        }
    }

    console.log('\n4. Kiểm tra lại qua Public API...');
    const { body: publicList } = await call(
        '/cms/documents?limit=100&sortBy=issued_at&sortOrder=DESC',
    );
    const total = publicList?.metadata?.total ?? publicList?.data?.items?.length ?? 0;

    console.log('\n=== KẾT QUẢ ===');
    console.log(`  Tạo mới        : ${created.length}`);
    console.log(`  Bỏ qua (trùng) : ${skipped}`);
    console.log(`  Thất bại       : ${failed.length}`);
    failed.forEach((f) => console.log(`    - ${f.code}: ${f.error}`));
    console.log(`  Tổng văn bản công khai hiện tại: ${total}`);
}

main().catch((error) => {
    console.error('LỖI KHÔNG MONG MUỐN:', error);
    process.exit(1);
});
