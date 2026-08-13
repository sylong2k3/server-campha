'use strict';
process.env.JWT_SECRET ||= 'test-map-tile-ticket-secret-at-least-32-characters';

const jwt = require('jsonwebtoken');
const { signTileTicket, verifyTileTicket } = require('../map-tile-ticket.util');

describe('map tile ticket', () => {
    test('signs a ticket that verifies for the same layer and access', () => {
        const { ticket, expiresAt } = signTileTicket(42, 'view');
        expect(expiresAt).toBeInstanceOf(Date);
        expect(verifyTileTicket(ticket, 42, 'view')).toBe(true);
    });

    test('rejects a ticket used for a different layer', () => {
        const { ticket } = signTileTicket(42, 'view');
        expect(verifyTileTicket(ticket, 99, 'view')).toBe(false);
    });

    test('rejects a ticket used for a different access level', () => {
        const { ticket } = signTileTicket(42, 'view');
        expect(verifyTileTicket(ticket, 42, 'export')).toBe(false);
    });

    test('rejects a token issued for a different purpose', () => {
        const foreign = jwt.sign(
            { layerId: 42, access: 'view', purpose: 'file_download' },
            process.env.JWT_SECRET,
            { expiresIn: '1m' },
        );
        expect(verifyTileTicket(foreign, 42, 'view')).toBe(false);
    });

    test('rejects an expired ticket', () => {
        const expired = jwt.sign(
            { layerId: 42, access: 'view', purpose: 'map_tile' },
            process.env.JWT_SECRET,
            { expiresIn: -1 },
        );
        expect(verifyTileTicket(expired, 42, 'view')).toBe(false);
    });

    test('rejects garbage input', () => {
        expect(verifyTileTicket('not-a-jwt', 42, 'view')).toBe(false);
    });
});
