const jwt = require('jsonwebtoken');
const config = require('../config');

// Returns the userId for a valid session token, or null.
function verifyToken(token) {
    if (!token) return null;
    try {
        const payload = jwt.verify(token, config.jwtSecret);
        return typeof payload.userId === 'string' ? payload.userId : null;
    } catch {
        return null;
    }
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided.' });
    }
    const userId = verifyToken(header.slice(7));
    if (!userId) return res.status(401).json({ error: 'Invalid or expired token.' });
    req.userId = userId;
    next();
}

module.exports = authMiddleware;
module.exports.verifyToken = verifyToken;
