const userRepository = require('../repositories/user.repository');
const tokenRepository = require('../repositories/token.repository');
const { hashPassword } = require('../utils/cryptoHelper.util');
const { Api400Error, Api403Error, Api404Error, Api409Error, Api503Error } = require('../core/error.response');
const { t } = require('../utils/i18n.util');
const { PG_UNIQUE_VIOLATION } = require('../core/pg-error-codes');
const activityLogger = require('../utils/activityLogger.util');
const ldapService = require('./ldap.service');
const ldapRepository = require('../repositories/ldap.repository');

const _hasUserPermission = (actor, action) => actor?.permissions?.users?.[action] === true;

const _assertAssignableRole = (actor, targetRoleCode) => {
    if (targetRoleCode === 'citizen') {return;}
    if (!_hasUserPermission(actor, 'change_role')) {
        throw new Api403Error(t('no_permission_resource', actor.lang, {
            resource: 'users', action: 'change_role',
        }));
    }
};

const _assertSameOrganization = (actor, targetUser) => {
    if (actor.orgId && targetUser.org_id === actor.orgId) {return;}
    throw new Api403Error(t('no_permission_resource', actor.lang, {
        resource: 'users', action: 'manage',
    }));
};

const _assertNotLastActiveSystemAdmin = async (targetUser, lang) => {
    if (targetUser.role !== 'system_admin') {return;}
    const activeSystemAdmins = await userRepository.countActiveUsersByRole('system_admin');
    if (activeSystemAdmins <= 1) {
        throw new Api400Error(t('invalid_data', lang), [t('cannot_modify_last_admin', lang)]);
    }
};

const _getOrThrow = async (userId, lang) => {
    const user = await userRepository.findById(userId);
    if (!user) {throw new Api404Error(t('user_not_found', lang));}
    return user;
};

const _sanitize = (user) => {
    if (!user) {return null;}
    const safe = { ...user };
    delete safe.password_hash;
    delete safe.login_attempts;
    delete safe.locked_until;
    return safe;
};

const _normalizeNullable = (value) => (value === '' ? null : value);

const _logAdminActivity = (actor, action, targetUserId, metadata = {}) =>
    activityLogger.logActivity('[USER]', {
        userId: actor.id || null,
        action,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: {
            targetUserId,
            actorRole: actor.role,
            ...metadata,
        },
    });

const listUsers = async (filter, actor) => {
    if (!actor.orgId) {
        throw new Api403Error(t('no_permission_resource', actor.lang, { resource: 'users', action: 'list' }));
    }
    const effectiveFilter = { ...filter, orgId: actor.orgId };
    const { items, total } = await userRepository.findAll(effectiveFilter);
    return { items: items.map(_sanitize), total };
};

const createUser = async ({
    authProvider = 'local',
    email,
    password,
    fullName,
    directoryUsername,
    phone,
    roleCode = 'citizen',
}, actor) => {
    _assertAssignableRole(actor, roleCode);
    if (!actor.orgId) {
        throw new Api403Error(t('no_permission_resource', actor.lang, { resource: 'users', action: 'create' }));
    }
    const role = await userRepository.findRoleByCode(roleCode);
    if (!role) {throw new Api400Error(t('invalid_data', actor.lang));}

    let directoryUser;
    if (authProvider === 'ldap') {
        try {
            directoryUser = await ldapService.findForProvision(directoryUsername);
        } catch (error) {
            if (error instanceof ldapService.LdapUnavailableError) {
                throw new Api503Error(t('ldap_unavailable', actor.lang), ['LDAP_UNAVAILABLE']);
            }
            throw new Api400Error(t('invalid_data', actor.lang));
        }
        if (!directoryUser.email) {throw new Api400Error(t('invalid_data', actor.lang));}
        email = directoryUser.email;
        fullName = directoryUser.fullName;
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) {throw new Api409Error(t('email_in_use', actor.lang));}

    let user;
    try {
        if (authProvider === 'ldap') {
            const userId = await ldapRepository.provision({
                email,
                fullName,
                roleCode,
                orgId: actor.orgId,
                externalId: directoryUser.externalId,
                loginName: directoryUser.loginName,
                distinguishedName: directoryUser.distinguishedName,
            });
            user = await userRepository.findById(userId);
        } else {
            const passwordHash = await hashPassword(password);
            user = await userRepository.create({
                email,
                passwordHash,
                fullName,
                phone: _normalizeNullable(phone),
                roleCode,
                orgId: actor.orgId,
                emailVerified: true,
            });
        }
    } catch (err) {
        if (err.code === PG_UNIQUE_VIOLATION) {
            throw new Api409Error(t('email_in_use', actor.lang));
        }
        throw err;
    }

    await _logAdminActivity(actor, 'user_create', user.id, {
        roleCode,
        orgId: actor.orgId,
        authProvider,
    });
    return _sanitize(user);
};

const changeUserRole = async (userId, roleCode, actor) => {
    _assertAssignableRole(actor, roleCode);
    const user = await _getOrThrow(userId, actor.lang);
    _assertSameOrganization(actor, user);
    if (actor.id === userId) {throw new Api400Error(t('invalid_data', actor.lang), [t('cannot_change_own_role', actor.lang)]);}
    if (user.role === 'system_admin' && roleCode !== 'system_admin') {
        await _assertNotLastActiveSystemAdmin(user, actor.lang);
    }
    const role = await userRepository.findRoleByCode(roleCode);
    if (!role) {throw new Api400Error(t('invalid_data', actor.lang));}
    const updated = await userRepository.updateRole(userId, roleCode);
    await Promise.all([
        userRepository.incrementTokenVersion(userId),
        tokenRepository.deleteAllUserTokens(userId),
    ]);
    await _logAdminActivity(actor, 'user_role_change', userId, { fromRole: user.role, toRole: roleCode });
    return _sanitize(updated);
};

const setUserActive = async (userId, isActive, actor) => {
    const user = await _getOrThrow(userId, actor.lang);
    _assertSameOrganization(actor, user);
    if (actor.id === userId) {throw new Api400Error(t('cannot_self_lock', actor.lang));}
    if (user.role === 'system_admin' && isActive === false) {
        await _assertNotLastActiveSystemAdmin(user, actor.lang);
    }
    const updated = await userRepository.updateActive(userId, isActive);

    if (!isActive) {
        await Promise.all([
            userRepository.incrementTokenVersion(userId),
            tokenRepository.deleteAllUserTokens(userId),
        ]);
    }

    await _logAdminActivity(actor, 'user_active_change', userId, { fromActive: user.is_active, toActive: isActive });
    return _sanitize(updated);
};

const resetUserPassword = async (userId, newPassword, actor) => {
    const user = await _getOrThrow(userId, actor.lang);
    _assertSameOrganization(actor, user);
    if (await ldapRepository.findByUserId(userId)) {
        throw new Api400Error(t('ldap_password_managed', actor.lang));
    }
    const passwordHash = await hashPassword(newPassword);
    await Promise.all([
        userRepository.updateTemporaryPassword(userId, passwordHash),
        userRepository.incrementTokenVersion(userId),
        tokenRepository.deleteAllUserTokens(userId),
    ]);
    await _logAdminActivity(actor, 'admin_password_reset', userId, { targetRole: user.role });
    return { message: t('password_reset_admin_success', actor.lang) };
};

const getUserById = async (userId, actor) => {
    const user = await _getOrThrow(userId, actor.lang);
    _assertSameOrganization(actor, user);
    return _sanitize(user);
};

const deleteUser = async (userId, actor) => {
    const user = await _getOrThrow(userId, actor.lang);
    _assertSameOrganization(actor, user);
    if (actor.id === userId) {throw new Api400Error(t('cannot_self_delete', actor.lang));}
    if (user.role === 'system_admin') {
        await _assertNotLastActiveSystemAdmin(user, actor.lang);
    }
    await userRepository.softDelete(userId);
    await Promise.all([
        userRepository.incrementTokenVersion(userId),
        tokenRepository.deleteAllUserTokens(userId),
    ]);
    await _logAdminActivity(actor, 'user_delete', userId, { targetRole: user.role, targetEmail: user.email });
    return { message: t('user_deleted_success', actor.lang) };
};


module.exports = {
    listUsers,
    createUser,
    changeUserRole,
    setUserActive,
    resetUserPassword,
    getUserById,
    deleteUser,
};
