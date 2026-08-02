'use strict';

if (process.env.DB_NAME !== 'campha_test') {
    throw new Error('Sprint 5 HTTP integration chỉ chạy trên campha_test');
}
jest.mock('../../../middlewares/auth.middleware', () => {
    const { Api401Error } = require('../../../core/error.response');
    const user = (req) => {
        const role = req.get('x-test-role');
        if (!role) {
            return null;
        }
        const manager = role !== 'citizen';
        return {
            id: Number(req.get('x-test-user-id')),
            role,
            org_id: 1,
            role_permissions: {
                news: manager
                    ? { read: true, create: true, update: true, delete: true, comment: true }
                    : { read_public: true, comment: true },
                documents: manager
                    ? {
                          read: true,
                          create: true,
                          delete: true,
                          read_internal: true,
                          download_internal: true,
                      }
                    : { read_public: true },
                pdf_maps: manager
                    ? { read: true, create: true, update: true, delete: true, download: true }
                    : { read_public: true, download: true },
            },
        };
    };
    return {
        optionalAuth: (req, _res, next) => {
            req.user = user(req);
            next();
        },
        verifyToken: (req, _res, next) => {
            req.user = user(req);
            next(req.user ? undefined : new Api401Error('Login required'));
        },
        enforcePasswordChange: (_req, _res, next) => next(),
        requireRole: () => (_req, _res, next) => next(),
        requirePermission: () => (_req, _res, next) => next(),
        hasPermission: () => true,
    };
});
const request = require('supertest');
const app = require('../../../app');
const db = require('../../../configs/database');
const repository = require('../../../repositories/cms.repository');

const PREFIX = 'it_s5_http_';
let userId;
let publicNews;
let internalNews;
const auth = (req, role = 'citizen') =>
    req.set('x-test-role', role).set('x-test-user-id', String(userId));
const cleanup = async () => db.query(`DELETE FROM cms.news WHERE title LIKE $1`, [`${PREFIX}%`]);

describe('Sprint 5 CMS HTTP integration', () => {
    beforeAll(async () => {
        await cleanup();
        const {
            rows: [user],
        } = await db.query(
            `SELECT id FROM auth.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`,
        );
        userId = user.id;
        publicNews = await repository.createNews(
            {
                title: `${PREFIX}Public`,
                content: 'Public content',
                visibility: 'public',
                status: 'published',
            },
            userId,
        );
        internalNews = await repository.createNews(
            {
                title: `${PREFIX}Internal`,
                content: 'Secret',
                visibility: 'internal',
                status: 'published',
            },
            userId,
        );
    });
    afterAll(async () => {
        await cleanup();
        db.stopPoolMonitor();
        await db.pool.end();
    });

    test('anonymous news API returns public published only', async () => {
        const response = await request(app).get(`/api/v1/cms/news?q=${PREFIX}`).expect(200);
        const ids = response.body.data.items.map((x) => Number(x.id));
        expect(ids).toContain(Number(publicNews.id));
        expect(ids).not.toContain(Number(internalNews.id));
        await request(app).get(`/api/v1/cms/news/${internalNews.id}`).expect(404);
    });
    test('comment requires login and rejects HTML at boundary', async () => {
        await request(app)
            .post(`/api/v1/cms/news/${publicNews.id}/comments`)
            .send({ content: 'x' })
            .expect(401);
        await auth(request(app).post(`/api/v1/cms/news/${publicNews.id}/comments`))
            .send({ content: '<script>x</script>' })
            .expect(400);
        const created = await auth(request(app).post(`/api/v1/cms/news/${publicNews.id}/comments`))
            .send({ content: 'Bình luận hợp lệ' })
            .expect(201);
        expect(created.body.data.status).toBe('pending');
    });
    test('citizen cannot call admin create endpoint', async () => {
        await auth(request(app).post('/api/v1/admin/cms/news'))
            .send({ title: 'x', content: 'x' })
            .expect(403);
    });
});
