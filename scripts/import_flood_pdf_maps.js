'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_BASE = process.env.API_REMOTE_URL || 'https://apicampha.tourismpj.pro.vn/api/v1';
const BANDO_DIR = 'C:\\Users\\SunSun\\Downloads\\LOP PHU TRUOC SAU NGAP\\BANDO';

const NEW_MAPS = [
    {
        file: 'truocngap2015.pdf',
        title: 'Bản đồ lớp phủ trước ngập năm 2015 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2015,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2015 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'saungap2015.pdf',
        title: 'Bản đồ lớp phủ sau ngập năm 2015 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2015,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2015 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'truocngap2018.pdf',
        title: 'Bản đồ lớp phủ trước ngập năm 2018 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2018,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2018 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'saungap2018.pdf',
        title: 'Bản đồ lớp phủ sau ngập năm 2018 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2018,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2018 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'truocngap2020.pdf',
        title: 'Bản đồ lớp phủ trước ngập năm 2020 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2020,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2020 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'saungap2020.pdf',
        title: 'Bản đồ lớp phủ sau ngập năm 2020 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2020,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2020 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'truocngap2022.pdf',
        title: 'Bản đồ lớp phủ trước ngập năm 2022 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2022,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2022 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'saungap2022.pdf',
        title: 'Bản đồ lớp phủ sau ngập năm 2022 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2022,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2022 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'truocngap2024.pdf',
        title: 'Bản đồ lớp phủ trước ngập năm 2024 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2024,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ hiện trạng lớp phủ đất trước đợt ngập lụt năm 2024 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
    {
        file: 'saungap2024.pdf',
        title: 'Bản đồ lớp phủ sau ngập năm 2024 — TP. Cẩm Phả',
        scaleLabel: '1:10.000',
        mapYear: 2024,
        preparingAgency: 'UBND thành phố Cẩm Phả',
        description: 'Bản đồ biến động lớp phủ đất sau đợt ngập lụt năm 2024 trên địa bàn thành phố Cẩm Phả.',
        visibility: 'public',
    },
];

async function main() {
    console.log('=== BẮT ĐẦU IMPORT BẢN ĐỒ PDF TRƯỚC VÀ SAU NGẬP VÀO HỆ THỐNG ===\n');

    // 1. Đăng nhập Admin qua API
    console.log('1. Đăng nhập tài khoản Quản trị hệ thống via API...');
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: 'admin@campha.gov.vn',
            password: 'CamPha@2026',
        }),
    }).then(r => r.json());

    if (loginRes.status !== 200 || !loginRes.data?.accessToken) {
        throw new Error(`Đăng nhập thất bại: ${JSON.stringify(loginRes)}`);
    }
    const token = loginRes.data.accessToken;
    console.log(' -> Đăng nhập thành công!');

    // 2. Lấy danh sách bản đồ PDF cũ qua Admin API
    console.log('\n2. Lấy danh sách bản đồ PDF hiện tại trong hệ thống...');
    const listRes = await fetch(`${API_BASE}/admin/cms/pdf-maps?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json());

    const existingMaps = listRes.data?.items || [];
    console.log(` -> Tìm thấy ${existingMaps.length} bản đồ PDF cũ.`);

    // 3. Xóa tất cả bản đồ PDF cũ qua Admin API
    if (existingMaps.length > 0) {
        console.log('\n3. Đang xóa bản đồ PDF cũ qua API...');
        for (const item of existingMaps) {
            const updatedAt = item.updated_at || item.updatedAt;
            const delRes = await fetch(
                `${API_BASE}/admin/cms/pdf-maps/${item.id}?expectedUpdatedAt=${encodeURIComponent(updatedAt)}&deleteFiles=true`,
                {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                },
            ).then(r => r.json());
            console.log(` -> Xóa bản đồ ID ${item.id} ("${item.title}"): ${delRes.message || delRes.status}`);
        }
    }

    // 4. Upload và Thêm 10 bản đồ PDF mới qua API
    console.log('\n4. Tải lên và tạo 10 bản đồ PDF mới từ thư mục BANDO...');
    const createdResults = [];
    for (let i = 0; i < NEW_MAPS.length; i++) {
        const item = NEW_MAPS[i];
        const filePath = path.join(BANDO_DIR, item.file);
        if (!fs.existsSync(filePath)) {
            console.error(`❌ Không tìm thấy tệp: ${filePath}`);
            continue;
        }

        const fileBuffer = fs.readFileSync(filePath);
        console.log(`\n[${i + 1}/${NEW_MAPS.length}] Uploading file "${item.file}" (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

        // 4a. Direct Upload tệp PDF lên Storage API
        const uploadRes = await fetch(`${API_BASE}/storage/uploads`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'x-file-category': 'documents',
                'x-file-name': item.file,
                'content-type': 'application/pdf',
                'content-length': String(fileBuffer.length),
            },
            body: fileBuffer,
        }).then(r => r.json());

        if (uploadRes.status !== 201 || !uploadRes.data?.id) {
            console.error(`❌ Upload tệp ${item.file} thất bại:`, uploadRes);
            continue;
        }

        const fileObjectId = Number(uploadRes.data.id);
        console.log(` -> Tải tệp thành công! fileObjectId: ${fileObjectId}`);

        // 4b. Tạo bản ghi Bản đồ PDF mới qua CMS API
        const createRes = await fetch(`${API_BASE}/admin/cms/pdf-maps`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: item.title,
                scaleLabel: item.scaleLabel,
                mapYear: item.mapYear,
                preparingAgency: item.preparingAgency,
                description: item.description,
                visibility: item.visibility,
                fileObjectId: fileObjectId,
            }),
        }).then(r => r.json());

        if (createRes.status !== 201) {
            console.error(`❌ Tạo bản đồ PDF ${item.title} thất bại:`, createRes);
        } else {
            console.log(` -> Tạo bản đồ thành công! PDF Map ID: ${createRes.data.id}`);
            createdResults.push(createRes.data);
        }
    }

    // 5. Kiểm tra lại kết quả danh sách bản đồ công khai
    console.log('\n5. Kiểm tra lại danh sách Bản đồ PDF công khai qua Public API...');
    const publicList = await fetch(`${API_BASE}/cms/pdf-maps?limit=50`).then(r => r.json());
    console.log(`\n🎉 HOÀN THÀNH! Tổng số bản đồ PDF mới trên hệ thống: ${publicList.metadata?.total || publicList.data?.items?.length}`);
    console.log('Danh sách bản đồ PDF công khai:');
    (publicList.data?.items || []).forEach(m => {
        console.log(`  - [ID ${m.id}] ${m.title} (${m.map_year || m.mapYear}) — Tỷ lệ: ${m.scale_label || m.scaleLabel}`);
    });
}

main().catch(err => {
    console.error('LỖI KHÔNG MONG MUỐN:', err);
    process.exit(1);
});
