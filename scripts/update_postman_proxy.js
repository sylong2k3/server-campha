'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../docs/api/campha.postman_collection.json');
const col = JSON.parse(fs.readFileSync(file, 'utf8'));

const storageFolder = col.item.find(i => i.name === 'Lưu trữ tệp');
if (!storageFolder) {
    throw new Error('Folder "Lưu trữ tệp" không tồn tại trong Postman Collection');
}

const newProxyItem = {
    name: 'Tải/xem tệp trực tiếp qua Proxy Backend (Stream)',
    request: {
        method: 'GET',
        header: [],
        url: {
            raw: '{{baseUrl}}/api/v1/storage/objects/{{storageObjectId}}/file?ticket={{storageTicket}}',
            host: ['{{baseUrl}}'],
            path: ['api', 'v1', 'storage', 'objects', '{{storageObjectId}}', 'file'],
            query: [
                {
                    key: 'ticket',
                    value: '{{storageTicket}}',
                },
            ],
        },
        description: 'Tải hoặc xem tệp trực tiếp thông qua luồng Proxy của Server Backend (không cần mở public cổng 9000 của MinIO). Hỗ trợ xác thực qua tham số query ?ticket= hoặc Bearer token.',
    },
    event: [
        {
            listen: 'test',
            script: {
                type: 'text/javascript',
                exec: ['pm.test("200 OK", () => pm.response.to.have.status(200));'],
            },
        },
    ],
};

const dlItem = storageFolder.item.find(i => i.name === 'Lấy URL tải xuống');
if (dlItem) {
    dlItem.event[0].script.exec = [
        'pm.test("200 OK", () => pm.response.to.have.status(200));',
        'const data = pm.response.json().data;',
        'if (data && data.url) {',
        '  pm.collectionVariables.set("storageDownloadUrl", data.url);',
        '  pm.environment.set("storageDownloadUrl", data.url);',
        '  const match = data.url.match(/[?&]ticket=([^&]+)/);',
        '  if (match && match[1]) {',
        '    pm.collectionVariables.set("storageTicket", decodeURIComponent(match[1]));',
        '    pm.environment.set("storageTicket", decodeURIComponent(match[1]));',
        '  }',
        '}',
    ];
}

const existingProxy = storageFolder.item.find(i => i.name.includes('Proxy'));
if (!existingProxy) {
    const deleteIndex = storageFolder.item.findIndex(i => i.name === 'Xóa tệp');
    if (deleteIndex !== -1) {
        storageFolder.item.splice(deleteIndex, 0, newProxyItem);
    } else {
        storageFolder.item.push(newProxyItem);
    }
}

fs.writeFileSync(file, JSON.stringify(col, null, 2), 'utf8');
console.log('CẬP NHẬT POSTMAN COLLECTION THÀNH CÔNG!');
