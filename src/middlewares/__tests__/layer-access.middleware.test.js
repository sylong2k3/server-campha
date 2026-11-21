process.env.JWT_SECRET ||= 'test-layer-access-ticket-secret-at-least-32-characters';
jest.mock('../../configs/database', () => ({ query: jest.fn() }));

const db = require('../../configs/database');
const { Api401Error, Api403Error, Api404Error } = require('../../core/error.response');
const { requireLayerAccess, clearLayerAccessCache } = require('../layer-access.middleware');
const { signTileTicket } = require('../../utils/map-tile-ticket.util');

const invoke = async (access, req) => {
    const next = jest.fn();
    await requireLayerAccess(access)(req, {}, next);
    return next.mock.calls[0]?.[0];
};

describe('requireLayerAccess', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearLayerAccessCache();
    });

    test('cho khách xem lớp public', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 1, is_public: true, allowed: false }] });
        const req = { params: { layerId: '1' }, lang: 'vi' };

        expect(await invoke('view', req)).toBeUndefined();
        expect(req.layerAcl.id).toBe(1);
    });

    test('cho khách xuất lớp public qua WFS', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 8, is_public: true, allowed: false }] });
        const req = { params: { layerId: '8' }, lang: 'vi' };

        expect(await invoke('export', req)).toBeUndefined();
        expect(req.layerAcl.id).toBe(8);
    });

    test('yêu cầu đăng nhập cho lớp private', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 2, is_public: false, allowed: false }] });
        const error = await invoke('view', { params: { layerId: '2' }, lang: 'vi' });
        expect(error).toBeInstanceOf(Api401Error);
    });

    test('từ chối action edit không được gis.layer_permissions.can_edit cấp', async () => {
        db.query.mockResolvedValue({
            rows: [{ id: 3, is_public: true, allowed: false }],
        });
        const error = await invoke('edit', {
            params: { layerId: '3' },
            lang: 'vi',
            user: { role: 'system_admin' },
        });
        expect(error).toBeInstanceOf(Api403Error);
    });

    test('vé hợp lệ cho phép xem lớp private mà không cần đăng nhập', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 4, is_public: false, allowed: false }] });
        const { ticket } = signTileTicket(4, 'view');
        const req = { params: { layerId: '4' }, lang: 'vi', query: { ticket } };

        expect(await invoke('view', req)).toBeUndefined();
        expect(req.layerAcl.id).toBe(4);
    });

    test('vé đúng layer nhưng sai access thì bị từ chối', async () => {
        const { ticket } = signTileTicket(5, 'export');
        const error = await invoke('view', {
            params: { layerId: '5' },
            lang: 'vi',
            query: { ticket },
        });
        expect(error).toBeInstanceOf(Api403Error);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('vé cho layer khác thì bị từ chối', async () => {
        const { ticket } = signTileTicket(6, 'view');
        const error = await invoke('view', {
            params: { layerId: '7' },
            lang: 'vi',
            query: { ticket },
        });
        expect(error).toBeInstanceOf(Api403Error);
        expect(db.query).not.toHaveBeenCalled();
    });

    test('vé rác thì bị từ chối', async () => {
        const error = await invoke('view', {
            params: { layerId: '4' },
            lang: 'vi',
            query: { ticket: 'not-a-jwt' },
        });
        expect(error).toBeInstanceOf(Api403Error);
    });

    describe('cache ACL theo lớp', () => {
        test('các tile liên tiếp cùng lớp và vai trò chỉ truy vấn DB một lần', async () => {
            db.query.mockResolvedValue({ rows: [{ id: 11, is_public: true, allowed: false }] });

            for (let i = 0; i < 5; i += 1) {
                const req = { params: { layerId: '11' }, lang: 'vi' };
                expect(await invoke('view', req)).toBeUndefined();
                expect(req.layerAcl.id).toBe(11);
            }
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        test('các tile đồng thời dùng chung một truy vấn đang chạy', async () => {
            let resolveQuery;
            db.query.mockReturnValue(
                new Promise((resolve) => {
                    resolveQuery = resolve;
                }),
            );
            const pending = Array.from({ length: 4 }, () =>
                invoke('view', { params: { layerId: '12' }, lang: 'vi' }),
            );
            resolveQuery({ rows: [{ id: 12, is_public: true, allowed: false }] });

            expect(await Promise.all(pending)).toEqual([undefined, undefined, undefined, undefined]);
            expect(db.query).toHaveBeenCalledTimes(1);
        });

        test('vai trò khác nhau được tra quyền riêng', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [{ id: 13, is_public: false, allowed: true }] })
                .mockResolvedValueOnce({ rows: [{ id: 13, is_public: false, allowed: false }] });

            const allowedReq = { params: { layerId: '13' }, lang: 'vi', user: { role: 'so_tnmt' } };
            expect(await invoke('view', allowedReq)).toBeUndefined();

            const deniedReq = { params: { layerId: '13' }, lang: 'vi', user: { role: 'citizen' } };
            expect(await invoke('view', deniedReq)).toBeInstanceOf(Api403Error);
            expect(db.query).toHaveBeenCalledTimes(2);
        });

        test('không cache lớp không tìm thấy hoặc truy vấn lỗi', async () => {
            db.query
                .mockResolvedValueOnce({ rows: [] })
                .mockRejectedValueOnce(new Error('db down'))
                .mockResolvedValueOnce({ rows: [{ id: 14, is_public: true, allowed: false }] });

            const req = () => ({ params: { layerId: '14' }, lang: 'vi' });
            expect(await invoke('view', req())).toBeInstanceOf(Api404Error);
            expect((await invoke('view', req())).message).toBe('db down');
            expect(await invoke('view', req())).toBeUndefined();
            expect(db.query).toHaveBeenCalledTimes(3);
        });

        test('mỗi request nhận bản sao riêng của bản ghi lớp', async () => {
            db.query.mockResolvedValue({ rows: [{ id: 15, is_public: true, allowed: false }] });
            const first = { params: { layerId: '15' }, lang: 'vi' };
            const second = { params: { layerId: '15' }, lang: 'vi' };
            await invoke('view', first);
            first.layerAcl.code = 'mutated';
            await invoke('view', second);
            expect(second.layerAcl.code).toBeUndefined();
        });
    });
});
