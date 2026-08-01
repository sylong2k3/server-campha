'use strict';

if (process.env.DB_NAME !== 'campha_test') { throw new Error('Sprint 5 integration chỉ chạy trên campha_test'); }
const db = require('../../../configs/database');
const repository = require('../../../repositories/cms.repository');

const PREFIX = 'it_s5_';
let userId;
let filePdf;
let fileXml;
const cleanup = async () => {
    await db.query(`DELETE FROM cms.news WHERE title LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM cms.documents WHERE title LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM cms.pdf_maps WHERE title LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM core.file_objects WHERE original_name LIKE $1`, [`${PREFIX}%`]);
};

describe('Sprint 5 CMS PostgreSQL integration', () => {
    beforeAll(async () => {
        await cleanup();
        const { rows: [user] } = await db.query(`SELECT id FROM auth.users WHERE deleted_at IS NULL ORDER BY id LIMIT 1`);
        userId = user.id;
        const suffix = Date.now();
        const { rows } = await db.query(`
            INSERT INTO core.file_objects(category,bucket,object_key,owner_user_id,original_name,detected_mime,scan_status,lifecycle_status,ready_at)
            VALUES
              ('documents','campha-documents',$1,$3,$2,'application/pdf','clean','ready',NOW()),
              ('documents','campha-documents',$4,$3,$5,'application/xml','clean','ready',NOW()) RETURNING *`,
        [`documents/${PREFIX}${suffix}.pdf`, `${PREFIX}${suffix}.pdf`, userId,
            `documents/${PREFIX}${suffix}.xml`, `${PREFIX}${suffix}.xml`]);
        [filePdf, fileXml] = rows;
    });
    afterAll(async () => { await cleanup(); db.stopPoolMonitor(); await db.pool.end(); });

    test('public news SQL hides draft and internal while Vietnamese search works', async () => {
        const published = await repository.createNews({ title: `${PREFIX}Cẩm Phả`, content: 'public', visibility: 'public', status: 'published' }, userId);
        await repository.createNews({ title: `${PREFIX}Draft`, content: 'draft', visibility: 'public', status: 'draft' }, userId);
        await repository.createNews({ title: `${PREFIX}Internal`, content: 'internal', visibility: 'internal', status: 'published' }, userId);
        const result = await repository.listNews({ q: `${PREFIX}cam pha`, page: 1, limit: 20 }, true);
        expect(result.items.map((x) => Number(x.id))).toEqual([Number(published.id)]);
        expect(await repository.findNews(published.id, true)).toMatchObject({ content: 'public' });
    });

    test('comments stay pending until moderation and public list only returns approved', async () => {
        const news = await repository.createNews({ title: `${PREFIX}Comment`, content: 'x', visibility: 'public', status: 'published' }, userId);
        const comment = await repository.createComment(news.id, 'Bình luận text', userId);
        expect((await repository.listComments(news.id, { page: 1, limit: 20 }, true)).items).toHaveLength(0);
        await repository.moderateComment(comment.id, 'approved', userId);
        expect((await repository.listComments(news.id, { page: 1, limit: 20 }, true)).items).toHaveLength(1);
    });

    test('document visibility is enforced in SQL and ready owned XML is accepted', async () => {
        const pub = await repository.createDocument({ title: `${PREFIX}Public doc`, documentCode: `${PREFIX}PUB`, issuingAgency: 'UBND', visibility: 'public', fileObjectId: fileXml.id }, userId);
        expect(pub).not.toBeNull();
        const admin = await repository.listDocuments({ page: 1, limit: 20 }, 'admin');
        const publicItems = await repository.listDocuments({ page: 1, limit: 20 }, 'public');
        expect(admin.items.map((x) => Number(x.id))).toContain(Number(pub.id));
        expect(publicItems.items.map((x) => Number(x.id))).toContain(Number(pub.id));
    });

    test('PDF map requires clean PDF and optimistic stale update is rejected', async () => {
        const map = await repository.createPdfMap({ title: `${PREFIX}Map`, scaleLabel: '1:10.000', mapYear: 2026, preparingAgency: 'UBND', visibility: 'public', fileObjectId: filePdf.id }, userId);
        expect(map).not.toBeNull();
        const updated = await repository.updatePdfMap(map.id, { title: `${PREFIX}Map updated`, expectedUpdatedAt: map.updated_at }, userId);
        expect(updated.title).toContain('updated');
        await expect(repository.updatePdfMap(map.id, { title: 'stale', expectedUpdatedAt: map.updated_at }, userId)).resolves.toBeNull();
        await expect(repository.createPdfMap({ title: `${PREFIX}Bad`, scaleLabel: '1:1', mapYear: 2026, preparingAgency: 'UBND', visibility: 'public', fileObjectId: fileXml.id }, userId)).resolves.toBeNull();
    });
});