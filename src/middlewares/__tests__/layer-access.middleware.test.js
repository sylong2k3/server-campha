process.env.JWT_SECRET ||= 'test-layer-access-ticket-secret-at-least-32-characters';
jest.mock('../../configs/database', () => ({ query: jest.fn() }));

const db = require('../../configs/database');
const { Api401Error, Api403Error } = require('../../core/error.response');
const { requireLayerAccess } = require('../layer-access.middleware');
const { signTileTicket } = require('../../utils/map-tile-ticket.util');

const invoke = async (access, req) => {
    const next = jest.fn();
    await requireLayerAccess(access)(req, {}, next);
    return next.mock.calls[0]?.[0];
};

describe('requireLayerAccess', () => {
    beforeEach(() => jest.clearAllMocks());

    test('cho khách xem lớp public', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 1, is_public: true, allowed: false }] });
        const req = { params: { layerId: '1' }, lang: 'vi' };

        expect(await invoke('view', req)).toBeUndefined();
        expect(req.layerAcl.id).toBe(1);
    });

    test('yêu cầu đăng nhập cho lớp private', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 2, is_public: false, allowed: false }] });
        const error = await invoke('view', { params: { layerId: '2' }, lang: 'vi' });
        expect(error).toBeInstanceOf(Api401Error);
    });

    test('từ chối action không được ACL cấp', async () => {
        db.query.mockResolvedValue({ rows: [{ id: 3, is_public: true, allowed: false }] });
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
});
