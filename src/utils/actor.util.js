const buildActor = (req) =>
    req.user
        ? {
              id: req.user.id,
              role: req.user.role,
              orgId: req.user.org_id,
              permissions: req.user.role_permissions,
              lang: req.lang,
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
          }
        : null;

module.exports = { buildActor };
