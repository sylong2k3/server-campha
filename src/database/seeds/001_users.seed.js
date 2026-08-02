/**
 * Seed 5 tài khoản mẫu tương ứng 5 vai trò đăng nhập của dự án Cẩm Phả.
 * KH là anonymous; GEE dùng service account nên không seed vào auth.users.
 * Idempotent: nếu email đã tồn tại thì cập nhật mật khẩu.
 *
 * Chạy: node src/database/seeds/001_users.seed.js
 */
require('dotenv').config();

const db = require('../../configs/database');
const userRepository = require('../../repositories/user.repository');
const { hashPassword } = require('../../utils/cryptoHelper.util');
const { t } = require('../../utils/i18n.util');

const getLang = () => process.env.APP_LANG || process.env.LANG || 'vi';

// Chỉ dùng local/dev. Production phải cấp mật khẩu riêng qua kênh bí mật.
const DEFAULT_PASSWORD = 'CamPha@2026';

const USERS = [
    {
        email: 'admin@campha.gov.vn',
        fullName: 'Quản trị hệ thống Cẩm Phả',
        phone: '0260111111',
        roleCode: 'system_admin',
        orgCode: 'van_hanh_campha',
    },
    {
        email: 'ubnd@campha.gov.vn',
        fullName: 'UBND thành phố Cẩm Phả',
        phone: '0260222222',
        roleCode: 'ubnd_tp',
        orgCode: 'ubnd_campha',
    },
    {
        email: 'tnmt@campha.gov.vn',
        fullName: 'Sở Tài nguyên và Môi trường Quảng Ninh',
        phone: '0260333333',
        roleCode: 'so_tnmt',
        orgCode: 'so_tnmt_qn',
    },
    {
        email: 'xaydung@campha.gov.vn',
        fullName: 'Sở Xây dựng Quảng Ninh',
        phone: '0260444444',
        roleCode: 'so_xd',
        orgCode: 'so_xd_qn',
    },
    {
        email: 'citizen@campha.gov.vn',
        fullName: 'Người dân Cẩm Phả',
        phone: '0260555555',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
    },
];

(async () => {
    try {
        for (const u of USERS) {
            const passwordHash = await hashPassword(DEFAULT_PASSWORD);
            const existing = await userRepository.findByEmail(u.email);
            const { rows: organizations } = await db.query(
                'SELECT id FROM auth.organizations WHERE code = $1 AND is_active = true',
                [u.orgCode],
            );
            const orgId = organizations[0]?.id;
            if (!orgId) {
                throw new Error(`Missing organization: ${u.orgCode}`);
            }

            if (existing) {
                await db.query(
                    `UPDATE auth.users
                     SET password_hash = $2, password_changed_at = NOW(), must_change_password = false,
                         full_name = $3, phone = $4,
                         role_id = (SELECT id FROM auth.roles WHERE code = $5 AND is_active = true),
                         org_id = $6,
                         email_verified = true,
                         email_verified_at = COALESCE(email_verified_at, NOW())
                     WHERE id = $1`,
                    [existing.id, passwordHash, u.fullName, u.phone, u.roleCode, orgId],
                );
                console.log(
                    t('seed_user_password_updated', getLang(), {
                        id: existing.id,
                        email: u.email,
                        role: u.roleCode,
                    }),
                );
                continue;
            }

            const created = await userRepository.create({
                email: u.email,
                passwordHash,
                fullName: u.fullName,
                phone: u.phone,
                roleCode: u.roleCode,
                orgId,
                emailVerified: true,
            });

            console.log(
                t('seed_user_created', getLang(), {
                    id: created.id,
                    email: u.email,
                    role: u.roleCode,
                }),
            );
        }

        console.log(`\n${t('seed_user_completed', getLang(), { password: DEFAULT_PASSWORD })}`);
        await db.pool.end();
        process.exit(0);
    } catch (e) {
        console.error('SEED FAILED:', e.message);
        await db.pool.end().catch(() => {});
        process.exit(1);
    }
})();
