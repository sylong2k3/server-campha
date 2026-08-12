'use strict';

const { directUploadHeadersSchema } = require('../storage.validator');

describe('storage direct upload headers', () => {
    test('accepts and converts trusted upload headers', () => {
        const { error, value } = directUploadHeadersSchema.validate({
            'x-file-category': 'raster',
            'x-file-name': 'lop-phu.tif',
            'content-type': 'image/tiff',
            'content-length': '1024',
        });
        expect(error).toBeUndefined();
        expect(value['content-length']).toBe(1024);
    });

    test.each([
        [{ 'x-file-name': 'a.tif', 'content-type': 'image/tiff', 'content-length': '4' }],
        [{ 'x-file-category': 'raster', 'x-file-name': 'a.tif', 'content-type': 'image/tiff' }],
        [
            {
                'x-file-category': 'unknown',
                'x-file-name': 'a.tif',
                'content-type': 'image/tiff',
                'content-length': '4',
            },
        ],
    ])('rejects incomplete or unsupported headers', (headers) => {
        expect(directUploadHeadersSchema.validate(headers).error).toBeDefined();
    });
});
