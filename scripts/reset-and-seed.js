/**
 * reset-and-seed.js
 * Xóa toàn bộ schema nghiệp vụ, chạy lại migrations từ đầu, seed 5 tài khoản mẫu.
 *
 * Chạy: node scripts/reset-and-seed.js
 */
'use strict';

require('dotenv').config();

const db = require('../src/configs/database');
const { runMigrations } = require('../src/database/migrate');
const userRepository = require('../src/repositories/user.repository');
const { hashPassword } = require('../src/utils/cryptoHelper.util');

const DEFAULT_PASSWORD = 'CamPha@2026';

const USERS = [
    { email: 'admin@campha.gov.vn',   fullName: 'Quản trị hệ thống Cẩm Phả',              phone: '0260111111', roleCode: 'system_admin', orgCode: 'van_hanh_campha' },
    { email: 'ubnd@campha.gov.vn',    fullName: 'UBND thành phố Cẩm Phả',                  phone: '0260222222', roleCode: 'ubnd_tp',      orgCode: 'ubnd_campha'     },
    { email: 'tnmt@campha.gov.vn',    fullName: 'Sở Tài nguyên và Môi trường Quảng Ninh',  phone: '0260333333', roleCode: 'so_tnmt',      orgCode: 'so_tnmt_qn'      },
    { email: 'xaydung@campha.gov.vn', fullName: 'Sở Xây dựng Quảng Ninh',                  phone: '0260444444', roleCode: 'so_xd',        orgCode: 'so_xd_qn'        },
    { email: 'citizen@campha.gov.vn', fullName: 'Người dân Cẩm Phả',                       phone: '0260555555', roleCode: 'citizen',      orgCode: 'ubnd_campha'     },
];

async function dropAllSchemas() {
    console.log('\n[1/3] Xóa toàn bộ schema...');
    // Thứ tự drop: schema nghiệp vụ trước, core/auth cuối
    const schemas = ['raster', 'cms', 'logs', 'gis', 'auth', 'core'];
    for (const schema of schemas) {
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        console.log(`  ✓ DROP SCHEMA ${schema}`);
    }
    // Xóa bảng migration để force chạy lại từ đầu
    await db.query(`DROP TABLE IF EXISTS core.schema_migrations`);
    console.log('  ✓ Xóa xong tất cả schema.');
}

async function runAllMigrations() {
    console.log('\n[2/3] Chạy lại toàn bộ migrations...');
    await runMigrations();
    console.log('  ✓ Migrations hoàn tất.');
}

async function seedUsers() {
    console.log('\n[3/3] Seed 5 tài khoản mẫu...');
    const passwordHash = await hashPassword(DEFAULT_PASSWORD);

    for (const u of USERS) {
        const { rows: orgs } = await db.query(
            'SELECT id FROM auth.organizations WHERE code = $1 AND is_active = true',
            [u.orgCode]
        );
        const orgId = orgs[0]?.id;
        if (!orgId) throw new Error(`Không tìm thấy organization: ${u.orgCode}`);

        const existing = await userRepository.findByEmail(u.email);
        if (existing) {
            await db.query(
                `UPDATE auth.users
                 SET password_hash = $2, password_changed_at = NOW(), must_change_password = false,
                     full_name = $3, phone = $4,
                     role_id = (SELECT id FROM auth.roles WHERE code = $5 AND is_active = true),
                     org_id = $6,
                     email_verified = true, email_verified_at = COALESCE(email_verified_at, NOW()),
                     is_active = true, deleted_at = NULL
                 WHERE id = $1`,
                [existing.id, passwordHash, u.fullName, u.phone, u.roleCode, orgId]
            );
            console.log(`  ↻ Cập nhật: ${u.email} [${u.roleCode}]`);
        } else {
            const created = await userRepository.create({
                email: u.email,
                passwordHash,
                fullName: u.fullName,
                phone: u.phone,
                roleCode: u.roleCode,
                orgId,
                emailVerified: true,
            });
            // Kích hoạt tài khoản mới
            await db.query(
                'UPDATE auth.users SET is_active = true WHERE id = $1',
                [created.id]
            );
            console.log(`  ✓ Tạo mới: ${u.email} [${u.roleCode}]`);
        }
    }

    console.log(`\n  Mật khẩu chung: ${DEFAULT_PASSWORD}`);
    console.log('  is_active = true cho tất cả tài khoản.');
}

(async () => {
    try {
        await dropAllSchemas();
        await runAllMigrations();
        await seedUsers();
        console.log('\n✅ Reset & seed hoàn tất!\n');
    } catch (e) {
        console.error('\n❌ Lỗi:', e.message);
        console.error(e.stack);
        process.exit(1);
    } finally {
        await db.pool.end().catch(() => {});
        process.exit(0);
    }
})();
