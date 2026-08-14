'use strict';

const { resolveCollectionSources } = require('../builders/optical');

describe('satellite optical collection plan', () => {
    test('uses the legacy merged collection for AUTO', () => {
        expect(resolveCollectionSources('AUTO')).toEqual(['L8', 'L9', 'S2']);
    });

    test('keeps explicit client collection selections explicit', () => {
        expect(resolveCollectionSources('S2')).toEqual(['S2']);
        expect(resolveCollectionSources('L8')).toEqual(['L8']);
        expect(resolveCollectionSources('L9')).toEqual(['L9']);
        expect(resolveCollectionSources('LANDSAT')).toEqual(['L8', 'L9']);
    });
});
