'use strict';

/**
 * Client REST tối giản dùng chung cho các script import dữ liệu CMS.
 * Mọi thao tác đều đi qua API công khai của hệ thống (không ghi thẳng vào CSDL)
 * để giữ nguyên kiểm tra phân quyền, quét virus và vòng đời file.
 */

const DEFAULT_API_BASE = 'https://apicampha.tourismpj.pro.vn/api/v1';

const resolveApiBase = () =>
    (process.env.API_REMOTE_URL || DEFAULT_API_BASE).replace(/\/+$/, '');

const createClient = (apiBase = resolveApiBase()) => {
    let token = null;

    const call = async (path, options = {}) => {
        const headers = { ...(options.headers || {}) };
        if (token && !headers.Authorization) {
            headers.Authorization = `Bearer ${token}`;
        }
        const response = await fetch(`${apiBase}${path}`, { ...options, headers });
        const raw = await response.text();
        let body;
        try {
            body = raw ? JSON.parse(raw) : {};
        } catch {
            body = { raw };
        }
        return { httpStatus: response.status, body };
    };

    const login = async (email, password) => {
        const { httpStatus, body } = await call('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const accessToken = body?.data?.accessToken;
        if (!accessToken) {
            throw new Error(`Đăng nhập thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
        }
        token = accessToken;
        const user = body.data.user || {};
        return { user, roleCode: user.role?.code || user.role_code || user.role || 'n/a' };
    };

    /** Duyệt hết các trang của một endpoint danh sách và trả về mảng items. */
    const listAll = async (path, { limit = 100, maxPages = 20 } = {}) => {
        const items = [];
        for (let page = 1; page <= maxPages; page += 1) {
            const separator = path.includes('?') ? '&' : '?';
            const { httpStatus, body } = await call(`${path}${separator}page=${page}&limit=${limit}`);
            if (httpStatus !== 200) {
                throw new Error(
                    `Không đọc được ${path} (HTTP ${httpStatus}): ${JSON.stringify(body)}`,
                );
            }
            const batch = body?.data?.items || [];
            items.push(...batch);
            if (batch.length < limit) {
                break;
            }
        }
        return items;
    };

    /** Direct upload một file PDF vào category `documents`, trả về fileObjectId. */
    const uploadPdf = async (fileName, buffer) => {
        const { httpStatus, body } = await call('/storage/uploads', {
            method: 'POST',
            headers: {
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

    const postJson = async (path, payload, { expect = 201, label = path } = {}) => {
        const { httpStatus, body } = await call(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (httpStatus !== expect) {
            throw new Error(`${label} thất bại (HTTP ${httpStatus}): ${JSON.stringify(body)}`);
        }
        return body.data;
    };

    return { apiBase, call, login, listAll, uploadPdf, postJson };
};

module.exports = { createClient, resolveApiBase, DEFAULT_API_BASE };
