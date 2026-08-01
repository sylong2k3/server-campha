'use strict';
const {detectFileType,CATEGORY_EXTENSIONS}=require('../file-signature.util');
describe('Sprint 8 field photo privacy',()=>{
 test('allows PNG and valid WebP signatures',()=>{expect(detectFileType({category:'field-photos',originalName:'a.png',head:Buffer.from('89504e470d0a1a0a','hex')})).toBe('image/png');const webp=Buffer.alloc(16);webp.write('RIFF',0);webp.write('WEBP',8);expect(detectFileType({category:'field-photos',originalName:'a.webp',head:webp})).toBe('image/webp');});
 test('rejects JPEG and spoofed WebP',()=>{expect(CATEGORY_EXTENSIONS['field-photos'].has('.jpg')).toBe(false);const fake=Buffer.alloc(16);fake.write('RIFF',0);expect(detectFileType({category:'field-photos',originalName:'a.webp',head:fake})).toBeNull();});
});