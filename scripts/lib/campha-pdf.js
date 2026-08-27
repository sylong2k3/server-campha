'use strict';

/**
 * Sinh file PDF mẫu (văn bản hành chính và bản đồ) ngay trong bộ nhớ, không phụ
 * thuộc thư viện ngoài. Dùng chung cho các script import dữ liệu CMS.
 *
 * Font sử dụng là Helvetica chuẩn của PDF (WinAnsiEncoding) nên nội dung in ra
 * được bỏ dấu tiếng Việt; metadata lưu trong CSDL vẫn giữ nguyên dấu.
 */

const fs = require('fs');
const path = require('path');

const BOUNDARY_PATH = path.join(__dirname, '..', '..', 'src', 'data', 'cp_rg.geojson');

// ---------------------------------------------------------------------------
//  Text helpers
// ---------------------------------------------------------------------------
const deaccent = (text) =>
    String(text)
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
    for (const word of String(text).split(/\s+/)) {
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

const safeFileName = (name) => `${deaccent(name).replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;

// ---------------------------------------------------------------------------
//  Content-stream primitives
// ---------------------------------------------------------------------------
const show = (x, y, text, font, size) =>
    `/${font} ${size} Tf\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${escapePdfText(deaccent(text))}) Tj`;

const rgbFill = ([r, g, b]) => `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`;
const rgbStroke = ([r, g, b]) => `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`;

/** Ghép các object PDF thành file hoàn chỉnh kèm bảng xref đúng offset. */
const assemblePdf = ({ mediaBox, stream }) => {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] `
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

// ---------------------------------------------------------------------------
//  Văn bản hành chính (A4 dọc)
// ---------------------------------------------------------------------------
/**
 * @param {object} spec
 * @param {string} spec.agency        Cơ quan ban hành
 * @param {string} [spec.docNumber]   Số/ký hiệu văn bản
 * @param {string} spec.title         Trích yếu
 * @param {Array<[string,string]>} spec.meta   Cặp nhãn/giá trị in dưới trích yếu
 * @param {string[]} spec.body        Các đoạn nội dung
 */
const buildTextPdf = (spec) => {
    const lines = [];
    const push = (text, font, size, leading) => lines.push({ text, font, size, leading });

    push(spec.agency.toUpperCase(), 'F2', 11, 16);
    push('CONG HOA XA HOI CHU NGHIA VIET NAM', 'F2', 11, 14);
    push('Doc lap - Tu do - Hanh phuc', 'F1', 10, 22);
    if (spec.docNumber) {
        push(`So: ${spec.docNumber}`, 'F1', 10, 22);
    }
    for (const chunk of wrap(spec.title, 62)) {
        push(chunk, 'F2', 13, 18);
    }
    for (const [label, value] of spec.meta || []) {
        push(`${label}: ${value}`, 'F1', 10, 12);
    }
    push('', 'F1', 10, 10);
    for (const paragraph of spec.body || []) {
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
            parts.push(show(50, y, line.text, line.font, line.size));
        }
        y -= line.leading;
    }
    parts.push('ET');
    return assemblePdf({ mediaBox: '0 0 595.28 841.89', stream: parts.join('\n') });
};

// ---------------------------------------------------------------------------
//  Bản đồ (A4 ngang) — vẽ ranh giới thật của TP. Cẩm Phả
// ---------------------------------------------------------------------------
let boundaryCache = null;

/** Đọc ranh giới hành chính Cẩm Phả từ src/data/cp_rg.geojson thành danh sách ring. */
const loadCamPhaBoundary = () => {
    if (boundaryCache) {
        return boundaryCache;
    }
    const geojson = JSON.parse(fs.readFileSync(BOUNDARY_PATH, 'utf8'));
    const rings = [];
    const collectRings = (geometry) => {
        if (geometry.type === 'Polygon') {
            rings.push(...geometry.coordinates);
        } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach((polygon) => rings.push(...polygon));
        }
    };
    geojson.features.forEach((feature) => collectRings(feature.geometry));

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const ring of rings) {
        for (const [lon, lat] of ring) {
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
        }
    }
    boundaryCache = { rings, bbox: { minLon, minLat, maxLon, maxLat } };
    return boundaryCache;
};

/** Chiếu lon/lat vào khung bản đồ, giữ đúng tỷ lệ theo vĩ độ trung tâm. */
const makeProjector = (bbox, frame) => {
    const lat0 = ((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180);
    const kx = Math.cos(lat0);
    const spanX = (bbox.maxLon - bbox.minLon) * kx;
    const spanY = bbox.maxLat - bbox.minLat;
    const scale = Math.min(frame.width / spanX, frame.height / spanY) * 0.92;
    const offsetX = frame.x + (frame.width - spanX * scale) / 2;
    const offsetY = frame.y + (frame.height - spanY * scale) / 2;
    const project = (lon, lat) => [
        offsetX + (lon - bbox.minLon) * kx * scale,
        offsetY + (lat - bbox.minLat) * scale,
    ];
    return { project, scale, pointsPerKm: scale / 111.32 };
};

const KM_STEPS = [1, 2, 5, 10, 20, 50];

/**
 * @param {object} spec
 * @param {string} spec.title            Tên bản đồ
 * @param {string} spec.agency           Cơ quan thành lập
 * @param {string} spec.scaleLabel       Tỷ lệ, ví dụ '1:10.000'
 * @param {number} spec.mapYear          Năm thành lập
 * @param {string} spec.visibility       'public' | 'internal'
 * @param {Array<{color:number[],label:string}>} spec.legend  Chú giải (vẽ thành các dải màu)
 * @param {string[]} [spec.notes]        Ghi chú dưới chú giải
 */
const buildMapPdf = (spec) => {
    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const frame = { x: 38, y: 48, width: 545, height: 470 };
    const { rings, bbox } = loadCamPhaBoundary();
    const { project, pointsPerKm } = makeProjector(bbox, frame);

    const s = [];

    // Nền trang
    s.push(rgbFill([1, 1, 1]));
    s.push(`0 0 ${pageWidth} ${pageHeight} re f`);

    // Tiêu đề
    s.push('BT');
    s.push(rgbFill([0.06, 0.09, 0.16]));
    const titleChunks = wrap(spec.title, 58);
    let titleY = pageHeight - 34;
    for (const chunk of titleChunks) {
        s.push(show(frame.x, titleY, chunk, 'F2', 15));
        titleY -= 18;
    }
    s.push(rgbFill([0.3, 0.33, 0.4]));
    s.push(show(frame.x, titleY - 2, `${spec.agency}  |  Ty le ${spec.scaleLabel}  |  Nam ${spec.mapYear}`, 'F1', 9.5));
    s.push('ET');

    const frameTop = frame.y + frame.height;

    // Khung bản đồ + lưới toạ độ
    s.push(rgbFill([0.97, 0.98, 0.99]));
    s.push(`${frame.x} ${frame.y} ${frame.width} ${frame.height} re f`);
    s.push('0.5 w');
    s.push(rgbStroke([0.82, 0.85, 0.89]));
    for (let i = 1; i < 6; i += 1) {
        const gx = frame.x + (frame.width * i) / 6;
        const gy = frame.y + (frame.height * i) / 6;
        s.push(`${gx.toFixed(2)} ${frame.y} m ${gx.toFixed(2)} ${frameTop} l S`);
        s.push(`${frame.x} ${gy.toFixed(2)} m ${frame.x + frame.width} ${gy.toFixed(2)} l S`);
    }

    // Đường ranh giới hành chính
    const boundaryPath = rings
        .map((ring) => {
            const pts = ring.map(([lon, lat]) => project(lon, lat));
            const head = `${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} m`;
            const tail = pts
                .slice(1)
                .map(([px, py]) => `${px.toFixed(2)} ${py.toFixed(2)} l`)
                .join('\n');
            return `${head}\n${tail}\nh`;
        })
        .join('\n');

    // Các dải chuyên đề, cắt theo ranh giới (mô phỏng phân vùng của bản đồ thật)
    const legend = spec.legend || [];
    if (legend.length) {
        s.push('q');
        s.push(boundaryPath);
        s.push('W n');
        const bandHeight = frame.height / legend.length;
        legend.forEach((entry, index) => {
            const y0 = frame.y + bandHeight * (legend.length - 1 - index);
            s.push(rgbFill(entry.color));
            s.push(`${frame.x} ${y0.toFixed(2)} ${frame.width} ${bandHeight.toFixed(2)} re f`);
        });
        s.push('Q');
    }

    s.push('1 w');
    s.push(rgbStroke([0.15, 0.22, 0.33]));
    s.push(boundaryPath);
    s.push('S');

    s.push('0.8 w');
    s.push(rgbStroke([0.35, 0.4, 0.47]));
    s.push(`${frame.x} ${frame.y} ${frame.width} ${frame.height} re S`);

    // Nhãn toạ độ khung
    s.push('BT');
    s.push(rgbFill([0.35, 0.4, 0.47]));
    for (let i = 0; i <= 3; i += 1) {
        const lon = bbox.minLon + ((bbox.maxLon - bbox.minLon) * i) / 3;
        const lat = bbox.minLat + ((bbox.maxLat - bbox.minLat) * i) / 3;
        const [px] = project(lon, bbox.minLat);
        const [, py] = project(bbox.minLon, lat);
        s.push(show(Math.min(px, frame.x + frame.width - 34), frame.y - 11, `${lon.toFixed(3)}E`, 'F1', 7));
        s.push(show(frame.x + 3, Math.min(py, frameTop - 9), `${lat.toFixed(3)}N`, 'F1', 7));
    }
    s.push('ET');

    // Mũi tên chỉ hướng Bắc
    const arrowX = frame.x + frame.width - 30;
    const arrowY = frameTop - 46;
    s.push(rgbFill([0.15, 0.22, 0.33]));
    s.push(`${arrowX} ${arrowY + 26} m ${arrowX - 7} ${arrowY} l ${arrowX} ${arrowY + 7} l ${arrowX + 7} ${arrowY} l h f`);
    s.push('BT');
    s.push(show(arrowX - 3.5, arrowY - 11, 'B', 'F2', 9));
    s.push('ET');

    // Thước tỷ lệ
    const barKm = KM_STEPS.find((km) => km * pointsPerKm >= 70) || KM_STEPS[KM_STEPS.length - 1];
    const barWidth = barKm * pointsPerKm;
    const barX = frame.x + 14;
    const barY = frame.y + 16;
    s.push(rgbFill([1, 1, 1]));
    s.push(`${barX - 6} ${barY - 6} ${barWidth + 46} 26 re f`);
    s.push(rgbFill([0.15, 0.22, 0.33]));
    s.push(`${barX} ${barY} ${barWidth / 2} 5 re f`);
    s.push(rgbStroke([0.15, 0.22, 0.33]));
    s.push('0.6 w');
    s.push(`${barX} ${barY} ${barWidth} 5 re S`);
    s.push('BT');
    s.push(show(barX, barY + 10, `0${' '.repeat(6)}${barKm} km`, 'F1', 7.5));
    s.push('ET');

    // Bảng chú giải
    const panelX = frame.x + frame.width + 16;
    const panelWidth = pageWidth - panelX - 38;
    s.push(rgbFill([0.98, 0.98, 0.99]));
    s.push(`${panelX} ${frame.y} ${panelWidth} ${frame.height} re f`);
    s.push('0.8 w');
    s.push(rgbStroke([0.82, 0.85, 0.89]));
    s.push(`${panelX} ${frame.y} ${panelWidth} ${frame.height} re S`);

    let panelY = frameTop - 22;
    s.push('BT');
    s.push(rgbFill([0.06, 0.09, 0.16]));
    s.push(show(panelX + 12, panelY, 'CHU GIAI', 'F2', 10.5));
    s.push('ET');
    panelY -= 20;

    for (const entry of legend) {
        s.push(rgbFill(entry.color));
        s.push(`${panelX + 12} ${(panelY - 7).toFixed(2)} 16 11 re f`);
        s.push('0.5 w');
        s.push(rgbStroke([0.5, 0.55, 0.6]));
        s.push(`${panelX + 12} ${(panelY - 7).toFixed(2)} 16 11 re S`);
        s.push('BT');
        s.push(rgbFill([0.2, 0.24, 0.3]));
        const labelChunks = wrap(entry.label, 26);
        labelChunks.forEach((chunk, index) => {
            s.push(show(panelX + 34, panelY - index * 10, chunk, 'F1', 8));
        });
        s.push('ET');
        panelY -= Math.max(18, labelChunks.length * 10 + 8);
    }

    panelY -= 6;
    s.push('BT');
    s.push(rgbFill([0.35, 0.4, 0.47]));
    s.push(show(panelX + 12, panelY, 'GHI CHU', 'F2', 9));
    panelY -= 13;
    const notes = [
        `Pham vi: ${spec.visibility === 'public' ? 'Cong khai' : 'Noi bo'}`,
        'He toa do: VN-2000 / WGS-84',
        'Ranh gioi hanh chinh: TP. Cam Pha, tinh Quang Ninh',
        ...(spec.notes || []),
    ];
    for (const note of notes) {
        for (const chunk of wrap(note, 30)) {
            s.push(show(panelX + 12, panelY, chunk, 'F1', 7.5));
            panelY -= 10;
        }
    }
    s.push('ET');

    // Chân trang
    s.push('BT');
    s.push(rgbFill([0.55, 0.58, 0.63]));
    s.push(show(frame.x, 26, `${spec.agency} - Ban do mau phuc vu kiem thu he thong WebGIS Cam Pha.`, 'F1', 7.5));
    s.push('ET');

    return assemblePdf({ mediaBox: `0 0 ${pageWidth} ${pageHeight}`, stream: s.join('\n') });
};

module.exports = {
    deaccent,
    wrap,
    safeFileName,
    buildTextPdf,
    buildMapPdf,
    loadCamPhaBoundary,
};
