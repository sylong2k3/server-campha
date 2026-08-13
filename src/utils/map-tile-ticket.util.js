'use strict';
const jwt = require('jsonwebtoken');

const PURPOSE = 'map_tile';
const DEFAULT_TTL = process.env.MAP_TILE_TICKET_TTL || '15m';

const signTileTicket = (layerId, access) => {
    const token = jwt.sign(
        { layerId: Number(layerId), access, purpose: PURPOSE },
        process.env.JWT_SECRET,
        { expiresIn: DEFAULT_TTL },
    );
    const decoded = jwt.decode(token);
    return { ticket: token, expiresAt: new Date(decoded.exp * 1000) };
};

const verifyTileTicket = (ticket, layerId, access) => {
    let decoded;
    try {
        decoded = jwt.verify(ticket, process.env.JWT_SECRET);
    } catch {
        return false;
    }
    return (
        decoded.purpose === PURPOSE &&
        Number(decoded.layerId) === Number(layerId) &&
        decoded.access === access
    );
};

module.exports = { signTileTicket, verifyTileTicket };
