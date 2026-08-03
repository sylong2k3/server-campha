'use strict';

jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }));
jest.mock('http');
jest.mock('https');

const dns = require('dns').promises;
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

const { fetchSafely, isHostAllowed, isPrivateIp } = require('../ssrf-safe-fetch.util');

const ORIGINAL_ENV = process.env;

// Giả lập 1 request/response HTTP hoàn chỉnh cho client (http hoặc https đã mock).
const mockSuccessfulRequest = (
    client,
    { statusCode = 200, headers = {}, chunks = ['{}'] } = {},
) => {
    const req = new EventEmitter();
    req.destroy = jest.fn();
    req.end = jest.fn();
    client.request.mockImplementation((_options, callback) => {
        const res = new EventEmitter();
        res.statusCode = statusCode;
        res.headers = headers;
        res.resume = jest.fn();
        process.nextTick(() => {
            callback(res);
            for (const chunk of chunks) {
                res.emit('data', Buffer.from(chunk));
            }
            res.emit('end');
        });
        return req;
    });
    return req;
};

// Giả lập request "treo" — không bao giờ callback — để test caller tự bắn timeout/error.
const mockHangingRequest = (client) => {
    let req;
    client.request.mockImplementation(() => {
        req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = jest.fn();
        return req;
    });
    return () => req;
};

describe('ssrf-safe-fetch.util', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...ORIGINAL_ENV,
            KTTV_ALLOWED_SOURCE_HOSTS: 'api.open-meteo.com,nchmf.gov.vn',
        };
    });
    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    describe('isPrivateIp — IPv4', () => {
        test.each([
            ['10.0.0.1', true, 'RFC1918 10/8'],
            ['127.0.0.1', true, 'loopback'],
            ['169.254.169.254', true, 'link-local / cloud metadata'],
            ['172.16.0.1', true, 'RFC1918 172.16/12 (biên dưới)'],
            ['172.31.255.255', true, 'RFC1918 172.16/12 (biên trên)'],
            ['172.32.0.1', false, 'ngoài dải 172.16/12'],
            ['172.15.255.255', false, 'ngoài dải 172.16/12'],
            ['192.168.1.1', true, 'RFC1918 192.168/16'],
            ['100.64.0.1', true, 'CGNAT shared space (biên dưới)'],
            ['100.127.255.255', true, 'CGNAT shared space (biên trên)'],
            ['100.128.0.1', false, 'ngoài dải CGNAT'],
            ['0.0.0.0', true, '"this network"'],
            ['224.0.0.1', true, 'multicast'],
            ['8.8.8.8', false, 'IP công khai (Google DNS)'],
            ['1.1.1.1', false, 'IP công khai (Cloudflare DNS)'],
        ])('%s -> private=%s (%s)', (ip, expected) => {
            expect(isPrivateIp(ip)).toBe(expected);
        });
    });

    describe('isPrivateIp — IPv6', () => {
        test.each([
            ['::1', true, 'loopback'],
            ['::', true, 'unspecified'],
            ['fe80::1', true, 'link-local'],
            ['fc00::1', true, 'unique local fc00::/7'],
            ['fd12:3456::1', true, 'unique local fd..'],
            ['::ffff:127.0.0.1', true, 'IPv4-mapped loopback'],
            ['::ffff:8.8.8.8', false, 'IPv4-mapped công khai'],
            ['2001:4860:4860::8888', false, 'IPv6 công khai (Google DNS)'],
        ])('%s -> private=%s (%s)', (ip, expected) => {
            expect(isPrivateIp(ip)).toBe(expected);
        });
    });

    describe('isHostAllowed', () => {
        test('fail-closed khi chưa cấu hình allowlist', () => {
            process.env.KTTV_ALLOWED_SOURCE_HOSTS = '';
            expect(isHostAllowed('api.open-meteo.com')).toBe(false);
        });
        test('khớp domain chính xác', () => {
            expect(isHostAllowed('api.open-meteo.com')).toBe(true);
        });
        test('khớp subdomain của entry trong allowlist', () => {
            process.env.KTTV_ALLOWED_SOURCE_HOSTS = 'open-meteo.com';
            expect(isHostAllowed('api.open-meteo.com')).toBe(true);
        });
        test('KHÔNG khớp domain giả mạo dạng suffix (evil-open-meteo.com)', () => {
            process.env.KTTV_ALLOWED_SOURCE_HOSTS = 'open-meteo.com';
            expect(isHostAllowed('evil-open-meteo.com')).toBe(false);
        });
        test('KHÔNG khớp domain giả mạo dạng prefix (open-meteo.com.evil.com)', () => {
            process.env.KTTV_ALLOWED_SOURCE_HOSTS = 'open-meteo.com';
            expect(isHostAllowed('open-meteo.com.evil.com')).toBe(false);
        });
        test('so sánh không phân biệt hoa/thường', () => {
            process.env.KTTV_ALLOWED_SOURCE_HOSTS = 'API.OPEN-METEO.COM';
            expect(isHostAllowed('api.open-meteo.com')).toBe(true);
        });
    });

    describe('fetchSafely — chặn ở tầng URL/allowlist (không cần DNS)', () => {
        test('từ chối URL không hợp lệ', async () => {
            await expect(fetchSafely('not a url')).rejects.toMatchObject({
                status: 422,
                errors: ['INVALID_URL'],
            });
        });
        test('từ chối giao thức khác http/https', async () => {
            await expect(fetchSafely('ftp://api.open-meteo.com/x')).rejects.toMatchObject({
                status: 422,
                errors: ['INVALID_PROTOCOL'],
            });
        });
        test('từ chối domain ngoài allowlist (fail-closed)', async () => {
            await expect(fetchSafely('https://evil.example.com/x')).rejects.toMatchObject({
                status: 422,
                errors: ['SSRF_HOST_NOT_ALLOWED'],
            });
            expect(dns.lookup).not.toHaveBeenCalled();
        });
    });

    describe('fetchSafely — lớp chặn IP độc lập (defense-in-depth)', () => {
        test('chặn IP nội bộ dù domain ĐÃ nằm trong allowlist', async () => {
            dns.lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
            await expect(fetchSafely('https://api.open-meteo.com/x')).rejects.toMatchObject({
                status: 422,
                errors: ['SSRF_BLOCKED_IP'],
            });
        });
        test('chặn loopback dù domain ĐÃ nằm trong allowlist', async () => {
            dns.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
            await expect(fetchSafely('https://api.open-meteo.com/x')).rejects.toMatchObject({
                status: 422,
                errors: ['SSRF_BLOCKED_IP'],
            });
        });
        test('từ chối khi không phân giải được DNS', async () => {
            dns.lookup.mockRejectedValue(new Error('ENOTFOUND'));
            await expect(fetchSafely('https://api.open-meteo.com/x')).rejects.toMatchObject({
                status: 422,
                errors: ['DNS_RESOLUTION_FAILED'],
            });
        });
    });

    describe('fetchSafely — luồng thành công + các giới hạn khác', () => {
        test('kết nối thành công tới IP công khai đã kiểm chứng', async () => {
            dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
            mockSuccessfulRequest(https, {
                statusCode: 200,
                headers: { 'content-type': 'application/json' },
                chunks: ['{"ok":true}'],
            });
            const result = await fetchSafely('https://api.open-meteo.com/x');
            expect(result).toMatchObject({ status: 200, body: '{"ok":true}' });
        });
        test('không đi theo redirect — từ chối khi server trả 3xx', async () => {
            dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
            mockSuccessfulRequest(https, {
                statusCode: 302,
                headers: { location: 'https://evil.example.com' },
                chunks: [],
            });
            await expect(fetchSafely('https://api.open-meteo.com/x')).rejects.toMatchObject({
                status: 422,
                errors: ['SSRF_REDIRECT_BLOCKED'],
            });
        });
        test('giới hạn dung lượng phản hồi', async () => {
            dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
            mockSuccessfulRequest(https, { statusCode: 200, chunks: ['x'.repeat(2048)] });
            await expect(
                fetchSafely('https://api.open-meteo.com/x', { maxBytes: 1024 }),
            ).rejects.toMatchObject({ status: 422, errors: ['RESPONSE_TOO_LARGE'] });
        });
        test('từ chối khi quá thời gian chờ', async () => {
            dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
            const getReq = mockHangingRequest(https);
            const promise = fetchSafely('https://api.open-meteo.com/x', { timeoutMs: 50 });
            await new Promise((r) => process.nextTick(r));
            getReq().emit('timeout');
            await expect(promise).rejects.toMatchObject({
                status: 422,
                errors: ['CONNECTION_TIMEOUT'],
            });
            expect(getReq().destroy).toHaveBeenCalled();
        });
        test('từ chối khi lỗi kết nối mạng', async () => {
            dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
            const getReq = mockHangingRequest(https);
            const promise = fetchSafely('https://api.open-meteo.com/x');
            await new Promise((r) => process.nextTick(r));
            getReq().emit('error', new Error('ECONNREFUSED'));
            await expect(promise).rejects.toMatchObject({
                status: 422,
                errors: ['CONNECTION_FAILED'],
            });
        });
        test('dùng http.request (không phải https) khi URL là http://', async () => {
            dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
            mockSuccessfulRequest(http, { statusCode: 200, chunks: ['ok'] });
            await fetchSafely('http://api.open-meteo.com/x');
            expect(http.request).toHaveBeenCalled();
            expect(https.request).not.toHaveBeenCalled();
        });
    });

    describe('fetchSafely — pin IP qua option `lookup` (chặn DNS-rebinding)', () => {
        test('trả đúng định dạng mảng khi Node gọi với options.all=true (Happy Eyeballs)', async () => {
            dns.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
            let capturedLookup;
            https.request.mockImplementation((options, callback) => {
                capturedLookup = options.lookup;
                const req = new EventEmitter();
                req.destroy = jest.fn();
                req.end = jest.fn();
                const res = new EventEmitter();
                res.statusCode = 200;
                res.headers = {};
                res.resume = jest.fn();
                process.nextTick(() => {
                    callback(res);
                    res.emit('end');
                });
                return req;
            });
            await fetchSafely('https://api.open-meteo.com/x');

            const arrayForm = jest.fn();
            capturedLookup('api.open-meteo.com', { all: true }, arrayForm);
            expect(arrayForm).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);

            const singleForm = jest.fn();
            capturedLookup('api.open-meteo.com', {}, singleForm);
            expect(singleForm).toHaveBeenCalledWith(null, '8.8.8.8', 4);
        });
    });
});
