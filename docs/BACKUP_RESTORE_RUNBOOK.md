# Sao lưu và diễn tập khôi phục

## Mục tiêu

- Logical backup hằng ngày: `pg_dump --format=custom`, RPO ≤ 24 giờ.
- PITR production: `pg_basebackup` + WAL archive, RPO theo chu kỳ WAL (mục tiêu ≤ 15 phút).
- Restore drill hàng tháng vào DB tạm; ghi RTO thực đo.
- MinIO mirror hằng ngày sang volume/máy khác. Không dùng `--remove`.

## Điều kiện an toàn

> Không chạy restore vào `campha` hoặc `campha_test`. Script chỉ nhận `campha_restore_*`/`campha_test_restore_*` và tự xóa DB drill.

- PostgreSQL/MinIO native VPS, credential qua `.pgpass`, environment hoặc secret file mode `0600`.
- Backup đặt trên storage khác data volume; mã hóa storage; quyền đọc tối thiểu.
- Trước mọi thay đổi WAL: backup hiện tại, cửa sổ bảo trì, phê duyệt vận hành.

## Logical PostgreSQL

```bash
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=campha_backup PGDATABASE=campha
export BACKUP_DIR=/srv/backups/campha/postgres RETENTION_DAYS=14
./scripts/ops/backup-postgres.sh
```

Script tạo `.dump` + `.sha256`, kiểm tra TOC bằng `pg_restore --list`, chỉ publish file sau khi thành công.

## Restore drill

```bash
export BACKUP_FILE=/srv/backups/campha/postgres/campha_YYYYMMDDTHHMMSSZ.dump
export DRILL_DB=campha_restore_$(date +%Y%m%d)
./scripts/ops/restore-drill.sh
```

Acceptance: checksum đúng; restore không lỗi; PostGIS hoạt động; `core.schema_migrations`, `gis.layers`, `auth.users` tồn tại. Ghi thời gian bắt đầu/kết thúc, kích thước, migration count, lỗi.

## WAL/PITR

1. Cấu hình `wal_level=replica`, `archive_mode=on`.
2. `archive_command` phải copy-if-absent, atomic, trả nonzero khi thất bại.
3. Lấy base backup bằng `pg_basebackup --checkpoint=fast --wal-method=stream`.
4. Monitor `pg_stat_archiver.failed_count` và `last_failed_time`.
5. Drill trên PostgreSQL instance/data directory biệt lập: restore base backup, `restore_command`, `recovery.signal`, `recovery_target_time`.
6. Không ghi đè PGDATA production.

## MinIO

```bash
export MINIO_ALIAS=campha
export MINIO_BACKUP_DIR=/srv/backups/campha/minio/$(date +%F)
export MINIO_BUCKETS='layers raster documents field-photos quarantine'
./scripts/ops/backup-minio.sh
```

Dùng versioning/object lock ở đích nếu có. Hằng tháng chọn mẫu object, so size/hash, restore sang bucket drill rồi xóa drill.

## systemd timer

Service chạy user backup riêng, `EnvironmentFile` mode `0600`, `ProtectSystem=strict`, `ReadWritePaths=/srv/backups/campha`. Timer dùng `Persistent=true`, `OnCalendar=daily`. Không lưu password trong unit hoặc repository.