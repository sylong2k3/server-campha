'use strict';

/**
 * Lớp chặn SSRF cho US-10a.3/10a.4 — dùng khi hệ thống gọi ra URL do người dùng
 * (TNMT/XD) tự nhập khi khai báo nguồn KTTV. Đây là nơi rủi ro SSRF cao nhất dự án
 * (docs/KE_HOACH_XAY_DUNG_HE_THONG.md, Sprint 10a).
 *
 * Các lớp phòng thủ, theo đúng yêu cầu docs:
 *   1. Chỉ http/https, chặn scheme khác (file:, gopher:, ftp: dùng cơ chế riêng...).
 *   2. Allowlist tên miền — mặc định KHÔNG cho phép gì (fail-closed) cho tới khi
 *      cấu hình KTTV_ALLOWED_SOURCE_HOSTS.
 *   3. Chặn dải IP nội bộ/loopback/link-local sau khi resolve DNS.
 *   4. "Pin" IP đã kiểm chứng vào chính request thật (qua option `lookup`) để chặn
 *      tấn công DNS-rebinding (TOCTOU giữa lúc kiểm tra và lúc kết nối thật).
 *   5. Không đi theo redirect ra ngoài — dùng http/https.request thô (không tự
 *      redirect như fetch) và chủ động từ chối nếu server trả 3xx.
 *   6. Timeout cứng + giới hạn dung lượng tải.
 */

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const net = require('net');
const { Api422Error } = require('../core/error.response');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2MB — đủ cho preview, không đủ để DoS bộ nhớ

const getAllowedHosts = () =>
    String(process.env.KTTV_ALLOWED_SOURCE_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);

const isHostAllowed = (hostname) => {
    const allowed = getAllowedHosts();
    if (!allowed.length) {
        return false; // Chưa cấu hình allowlist → từ chối tất cả (fail-closed).
    }
    const host = hostname.toLowerCase();
    return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
};

const isPrivateIPv4 = (ip) => {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
        return true; // Không parse được → coi là không an toàn.
    }
    const [a, b] = parts;
    if (a === 0) {
        return true;
    } // "this network"
    if (a === 10) {
        return true;
    } // RFC1918
    if (a === 127) {
        return true;
    } // loopback
    if (a === 169 && b === 254) {
        return true;
    } // link-local / cloud metadata (169.254.169.254)
    if (a === 100 && b >= 64 && b <= 127) {
        return true;
    } // CGNAT shared space
    if (a === 172 && b >= 16 && b <= 31) {
        return true;
    } // RFC1918
    if (a === 192 && b === 168) {
        return true;
    } // RFC1918
    if (a >= 224) {
        return true;
    } // multicast/reserved/broadcast
    return false;
};

const isPrivateIPv6 = (ip) => {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') {
        return true;
    } // loopback / unspecified
    if (lower.startsWith('fe80:')) {
        return true;
    } // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
        return true;
    } // unique local fc00::/7
    if (lower.startsWith('::ffff:')) {
        return isPrivateIPv4(lower.split(':').pop()); // IPv4-mapped IPv6
    }
    return false;
};

const isPrivateIp = (ip) => (net.isIPv6(ip) ? isPrivateIPv6(ip) : isPrivateIPv4(ip));

const resolveAndValidateIp = async (hostname) => {
    let records;
    try {
        records = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new Api422Error('Không thể phân giải tên miền nguồn KTTV', ['DNS_RESOLUTION_FAILED']);
    }
    if (!records.length) {
        throw new Api422Error('Không thể phân giải tên miền nguồn KTTV', ['DNS_RESOLUTION_FAILED']);
    }
    for (const { address } of records) {
        if (isPrivateIp(address)) {
            throw new Api422Error('Địa chỉ IP nội bộ bị chặn (SSRF)', ['SSRF_BLOCKED_IP']);
        }
    }
    return records[0].address;
};

/**
 * Gọi GET tới `rawUrl` sau khi đã kiểm tra đầy đủ các lớp chặn SSRF ở trên.
 * @param {string} rawUrl
 * @param {{timeoutMs?: number, maxBytes?: number, headers?: object}} [options]
 * @returns {Promise<{status:number, headers:object, body:string}>}
 */
const fetchSafely = async (rawUrl, options = {}) => {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, headers = {} } = options;

    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Api422Error('URL nguồn KTTV không hợp lệ', ['INVALID_URL']);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Api422Error('Chỉ hỗ trợ giao thức http/https', ['INVALID_PROTOCOL']);
    }
    if (!isHostAllowed(url.hostname)) {
        throw new Api422Error('Tên miền nguồn KTTV chưa được cấp phép (allowlist)', [
            'SSRF_HOST_NOT_ALLOWED',
        ]);
    }

    const verifiedIp = await resolveAndValidateIp(url.hostname);
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = client.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                timeout: timeoutMs,
                headers: { 'User-Agent': 'campha-kttv-source-test/1.0', ...headers },
                // Pin IP đã kiểm chứng — chặn DNS-rebinding giữa lúc validate và lúc connect thật.
                // Node (Happy Eyeballs / autoSelectFamily) có thể gọi lookup với options.all=true,
                // khi đó callback phải nhận dạng mảng thay vì (err, address, family) đơn lẻ.
                lookup: (_hostname, opts, callback) => {
                    const isCallbackForm = typeof opts === 'function';
                    const options = isCallbackForm ? {} : opts || {};
                    const cb = isCallbackForm ? opts : callback;
                    const family = net.isIPv6(verifiedIp) ? 6 : 4;
                    if (options.all) {
                        cb(null, [{ address: verifiedIp, family }]);
                    } else {
                        cb(null, verifiedIp, family);
                    }
                },
            },
            (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400) {
                    res.resume();
                    reject(
                        new Api422Error('Nguồn KTTV trả về redirect — không được phép', [
                            'SSRF_REDIRECT_BLOCKED',
                        ]),
                    );
                    return;
                }
                const chunks = [];
                let total = 0;
                res.on('data', (chunk) => {
                    total += chunk.length;
                    if (total > maxBytes) {
                        req.destroy();
                        reject(
                            new Api422Error('Phản hồi vượt giới hạn dung lượng cho phép', [
                                'RESPONSE_TOO_LARGE',
                            ]),
                        );
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            },
        );
        req.on('timeout', () => {
            req.destroy();
            reject(
                new Api422Error(`Kết nối nguồn KTTV quá thời gian chờ (${timeoutMs}ms)`, [
                    'CONNECTION_TIMEOUT',
                ]),
            );
        });
        req.on('error', (err) => {
            reject(
                new Api422Error(`Không thể kết nối tới nguồn KTTV: ${err.message}`, [
                    'CONNECTION_FAILED',
                ]),
            );
        });
        req.end();
    });
};

module.exports = { fetchSafely, isHostAllowed, isPrivateIp };
