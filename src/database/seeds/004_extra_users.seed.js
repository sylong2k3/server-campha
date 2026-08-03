/**
 * Seed thêm người dùng mẫu đa dạng cho hệ thống Cẩm Phả:
 *  - 12 người dân (citizen) từ các phường khác nhau
 *  -  3 cán bộ UBND thành phố bổ sung
 *  -  3 chuyên viên Sở TN&MT bổ sung
 *  -  2 chuyên viên Sở Xây dựng bổ sung
 *
 * Idempotent: upsert theo email. Chạy sau 001_users.seed.js.
 * Chạy: node src/database/seeds/004_extra_users.seed.js
 */
'use strict';

require('dotenv').config();

const db = require('../../configs/database');
const userRepository = require('../../repositories/user.repository');
const { hashPassword } = require('../../utils/cryptoHelper.util');

const DEFAULT_PASSWORD = 'CamPha@2026';

// ---------------------------------------------------------------------------
//  Danh sách user mẫu bổ sung
// ---------------------------------------------------------------------------
const EXTRA_USERS = [
    // ── Người dân các phường ─────────────────────────────────────────────
    {
        email: 'nguyen.thi.lan@gmail.com',
        fullName: 'Nguyễn Thị Lan',
        phone: '0912345601',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cẩm Phú, TP. Cẩm Phả',
    },
    {
        email: 'tran.van.hung@gmail.com',
        fullName: 'Trần Văn Hùng',
        phone: '0912345602',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Quang Hanh, TP. Cẩm Phả',
    },
    {
        email: 'le.thi.mai@gmail.com',
        fullName: 'Lê Thị Mai',
        phone: '0912345603',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Mông Dương, TP. Cẩm Phả',
    },
    {
        email: 'pham.van.duc@gmail.com',
        fullName: 'Phạm Văn Đức',
        phone: '0912345604',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cẩm Thịnh, TP. Cẩm Phả',
    },
    {
        email: 'hoang.thi.hoa@gmail.com',
        fullName: 'Hoàng Thị Hoa',
        phone: '0912345605',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Dương Huy, TP. Cẩm Phả',
    },
    {
        email: 'vu.minh.tuan@gmail.com',
        fullName: 'Vũ Minh Tuấn',
        phone: '0912345606',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cẩm Bình, TP. Cẩm Phả',
    },
    {
        email: 'do.thi.thu@gmail.com',
        fullName: 'Đỗ Thị Thu',
        phone: '0912345607',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cẩm Tây, TP. Cẩm Phả',
    },
    {
        email: 'bui.van.long@gmail.com',
        fullName: 'Bùi Văn Long',
        phone: '0912345608',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cẩm Trung, TP. Cẩm Phả',
    },
    {
        email: 'truong.thi.nhung@gmail.com',
        fullName: 'Trương Thị Nhung',
        phone: '0912345609',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cẩm Đông, TP. Cẩm Phả',
    },
    {
        email: 'dinh.van.son@gmail.com',
        fullName: 'Đinh Văn Sơn',
        phone: '0912345610',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cẩm Sơn, TP. Cẩm Phả',
    },
    {
        email: 'nguyen.van.khanh@gmail.com',
        fullName: 'Nguyễn Văn Khánh',
        phone: '0912345611',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Phường Cửa Ông, TP. Cẩm Phả',
    },
    {
        email: 'tran.thi.yen@gmail.com',
        fullName: 'Trần Thị Yến',
        phone: '0912345612',
        roleCode: 'citizen',
        orgCode: 'ubnd_campha',
        address: 'Xã Cộng Hòa, TP. Cẩm Phả',
    },

    // ── Cán bộ UBND thành phố bổ sung ────────────────────────────────────
    {
        email: 'vanphong1@campha.gov.vn',
        fullName: 'Nguyễn Thành Nam — Văn phòng UBND',
        phone: '0260222223',
        roleCode: 'ubnd_tp',
        orgCode: 'ubnd_campha',
    },
    {
        email: 'pctt@campha.gov.vn',
        fullName: 'Trần Quốc Hưng — Ban chỉ huy PCTT',
        phone: '0260222224',
        roleCode: 'ubnd_tp',
        orgCode: 'ubnd_campha',
    },
    {
        email: 'doithi@campha.gov.vn',
        fullName: 'Lê Ngọc Bích — Phòng Quản lý Đô thị',
        phone: '0260222225',
        roleCode: 'ubnd_tp',
        orgCode: 'ubnd_campha',
    },

    // ── Chuyên viên Sở TN&MT bổ sung ─────────────────────────────────────
    {
        email: 'kttv1@campha.gov.vn',
        fullName: 'Phạm Hải Yến — Phòng KTTV & Biến đổi KH',
        phone: '0260333334',
        roleCode: 'so_tnmt',
        orgCode: 'so_tnmt_qn',
    },
    {
        email: 'moitruong1@campha.gov.vn',
        fullName: 'Hoàng Văn Minh — Chi cục Bảo vệ Môi trường',
        phone: '0260333335',
        roleCode: 'so_tnmt',
        orgCode: 'so_tnmt_qn',
    },
    {
        email: 'diachinh1@campha.gov.vn',
        fullName: 'Vũ Thị Phương — Phòng Đăng ký Đất đai',
        phone: '0260333336',
        roleCode: 'so_tnmt',
        orgCode: 'so_tnmt_qn',
    },

    // ── Chuyên viên Sở Xây dựng bổ sung ──────────────────────────────────
    {
        email: 'hatang1@campha.gov.vn',
        fullName: 'Đặng Quang Vinh — Phòng Hạ tầng Kỹ thuật',
        phone: '0260444445',
        roleCode: 'so_xd',
        orgCode: 'so_xd_qn',
    },
    {
        email: 'quyhoach1@campha.gov.vn',
        fullName: 'Bùi Thị Thanh Hà — Phòng Quy hoạch Xây dựng',
        phone: '0260444446',
        roleCode: 'so_xd',
        orgCode: 'so_xd_qn',
    },
];

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------
(async () => {
    try {
        let created = 0;
        let updated = 0;

        for (const u of EXTRA_USERS) {
            const passwordHash = await hashPassword(DEFAULT_PASSWORD);

            const { rows: orgs } = await db.query(
                `SELECT id FROM auth.organizations WHERE code=$1 AND is_active=true`,
                [u.orgCode],
            );
            const orgId = orgs[0]?.id;
            if (!orgId) {
                throw new Error(`Tổ chức không tồn tại: ${u.orgCode}`);
            }

            const existing = await userRepository.findByEmail(u.email);

            if (existing) {
                await db.query(
                    `UPDATE auth.users
                     SET password_hash=$2, full_name=$3, phone=$4,
                         role_id=(SELECT id FROM auth.roles WHERE code=$5 AND is_active=true),
                         org_id=$6, email_verified=true,
                         email_verified_at=COALESCE(email_verified_at, NOW()),
                         must_change_password=false
                     WHERE id=$1`,
                    [existing.id, passwordHash, u.fullName, u.phone, u.roleCode, orgId],
                );
                console.log(`  [UPD] ${u.email} (${u.roleCode})`);
                updated++;
            } else {
                await userRepository.create({
                    email: u.email,
                    passwordHash,
                    fullName: u.fullName,
                    phone: u.phone,
                    roleCode: u.roleCode,
                    orgId,
                    emailVerified: true,
                });
                console.log(`  [NEW] ${u.email} — ${u.fullName} (${u.roleCode})`);
                created++;
            }
        }

        console.log(`\nSeed users hoàn tất:`);
        console.log(`  Tạo mới : ${created}`);
        console.log(`  Cập nhật: ${updated}`);
        console.log(`  Mật khẩu mặc định: ${DEFAULT_PASSWORD}`);

        await db.pool.end();
        process.exit(0);
    } catch (e) {
        console.error('SEED FAILED:', e.message);
        await db.pool.end().catch(() => {});
        process.exit(1);
    }
})();
