'use strict';

jest.mock('../../repositories/cms.repository');
jest.mock('../minio.service', () => ({ getPresignedDownloadUrl: jest.fn() }));
jest.mock('../../utils/systemLogger.util', () => ({ logInfo: jest.fn() }));
const repository = require('../../repositories/cms.repository');
const minio = require('../minio.service');
const service = require('../cms.service');

const admin = { id: 2, role: 'so_tnmt', orgId: 1, permissions: {
    news: { read: true, create: true, update: true, delete: true, comment: true },
    documents: { read: true, create: true, delete: true, read_internal: true, download_internal: true },
    pdf_maps: { read: true, create: true, update: true, delete: true, download: true },
} };
const citizen = { id: 3, role: 'citizen', permissions: {
    news: { comment: true }, documents: { read_public: true }, pdf_maps: { download: true },
} };
const row = { id: 1, status: 'draft', visibility: 'public', object_key: 'o', original_name: 'a.pdf' };

describe('CMS service', () => {
    beforeEach(() => { jest.clearAllMocks(); minio.getPresignedDownloadUrl.mockResolvedValue({ url: 'signed', expiresAt: new Date() }); });
    test('delegates public and admin reads with correct visibility mode', async () => {
        repository.listNews.mockResolvedValue({ items: [], total: 0 }); repository.findNews.mockResolvedValue(row);
        await service.listPublicNews({}); await service.getPublicNews(1); await service.listAdminNews({}, admin); await service.getAdminNews(1, admin);
        expect(repository.listNews).toHaveBeenNthCalledWith(1, {}, true);
        expect(repository.listNews).toHaveBeenNthCalledWith(2, {}, false);
        expect(() => service.listAdminNews({}, citizen)).toThrow(expect.objectContaining({ status: 403 }));
    });
    test('creates updates deletes news and reports optimistic states', async () => {
        repository.createNews.mockResolvedValue(row); repository.updateNews.mockResolvedValue(row); repository.deleteNews.mockResolvedValue({ id: 1 });
        await expect(service.createNews({}, admin)).resolves.toBe(row);
        await expect(service.updateNews(1, {}, admin)).resolves.toBe(row);
        await expect(service.deleteNews(1, new Date(), admin)).resolves.toEqual({ id: 1 });
        repository.updateNews.mockResolvedValue(null); repository.findNews.mockResolvedValue(row);
        await expect(service.updateNews(1, {}, admin)).rejects.toMatchObject({ status: 409 });
        repository.findNews.mockResolvedValue(null);
        await expect(service.updateNews(1, {}, admin)).rejects.toMatchObject({ status: 404 });
        await expect(service.createNews({}, citizen)).rejects.toMatchObject({ status: 403 });
    });
    test('comments require permission and moderation handles missing rows', async () => {
        repository.listComments.mockResolvedValue({ items: [], total: 0 });
        await service.listPublicComments(1, {}); await service.listAdminComments(1, {}, admin);
        repository.createComment.mockResolvedValue(row); await expect(service.createComment(1, { content: 'x' }, admin)).resolves.toBe(row);
        repository.createComment.mockResolvedValue(null); await expect(service.createComment(1, { content: 'x' }, citizen)).rejects.toMatchObject({ status: 404 });
        repository.moderateComment.mockResolvedValue(row); await expect(service.moderateComment(1, 'approved', admin)).resolves.toBe(row);
        repository.moderateComment.mockResolvedValue(null); await expect(service.moderateComment(1, 'approved', admin)).rejects.toMatchObject({ status: 404 });
    });
    test('documents select public/internal/admin modes and validate file conflicts', async () => {
        repository.listDocuments.mockResolvedValue({ items: [], total: 0 }); repository.findDocument.mockResolvedValue(row);
        await service.listDocuments({}, null); await service.listDocuments({}, admin); await service.listDocuments({}, admin, true);
        expect(repository.listDocuments.mock.calls.map((x) => x[1])).toEqual(['public', 'admin', 'admin']);
        await service.getDocument(1, null); await service.getDocument(1, admin, true);
        repository.createDocument.mockResolvedValue(row); await expect(service.createDocument({}, admin)).resolves.toBe(row);
        repository.createDocument.mockResolvedValue(null); await expect(service.createDocument({}, admin)).rejects.toMatchObject({ status: 422 });
        repository.createDocument.mockRejectedValue({ code: '23505' }); await expect(service.createDocument({}, admin)).rejects.toMatchObject({ status: 409 });
        repository.deleteDocument.mockResolvedValue({ id: 1 }); await service.deleteDocument(1, new Date(), admin);
        await expect(service.documentDownload(1, 300, citizen)).rejects.toMatchObject({ status: 403 });
        await expect(service.documentDownload(1, 300, admin)).resolves.toMatchObject({ url: 'signed' });
    });
    test('PDF map CRUD read and download branches', async () => {
        repository.listPdfMaps.mockResolvedValue({ items: [], total: 0 }); repository.findPdfMap.mockResolvedValue(row);
        await service.listPdfMaps({}, null); await service.listPdfMaps({}, admin, true); await service.getPdfMap(1, null); await service.getPdfMap(1, admin, true);
        repository.createPdfMap.mockResolvedValue(row); await expect(service.createPdfMap({}, admin)).resolves.toBe(row);
        repository.createPdfMap.mockResolvedValue(null); await expect(service.createPdfMap({}, admin)).rejects.toMatchObject({ status: 422 });
        repository.createPdfMap.mockRejectedValue({ code: '23505' }); await expect(service.createPdfMap({}, admin)).rejects.toMatchObject({ status: 409 });
        repository.updatePdfMap.mockResolvedValue(row); repository.deletePdfMap.mockResolvedValue({ id: 1 });
        await service.updatePdfMap(1, {}, admin); await service.deletePdfMap(1, new Date(), admin);
        await expect(service.pdfMapDownload(1, 300, citizen)).resolves.toMatchObject({ url: 'signed' });
        await expect(service.pdfMapDownload(1, 300, null)).rejects.toMatchObject({ status: 403 });
    });
});