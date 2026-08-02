# Sprint 14 — Siêu dữ liệu, hiệu năng và gia cố

## Đã triển khai trong code

- Profile metadata địa lý strict, JSON + ISO 19139 XML; TNMT-only mutation.
- ETag/304 native, cache policy, CSP/Helmet, body limit, socket timeouts.
- GiST prefilter cho MVT/nearby; EXPLAIN integration 100.000 rows.
- Prometheus native: HTTP histogram, DB pool, layer job states; bearer protected.
- k6 staging contract 500 VU, p95 < 800 ms, error < 1%.
- `pg_dump`, isolated restore drill, MinIO mirror và WAL/PITR runbook.
- OWASP ASVS L2/API Top 10 checklist.

## Loại trừ

- Không Redis; HTTP conditional cache đủ cho hiện tại.
- Không GEE, KTTV.
- Không OpenAPI; Postman là contract duy nhất.
- Không tự tuyên bố TCVN certification hoặc pentest độc lập đạt.
- Không chạy load/restore trên production.

## Manual acceptance còn lại

1. Đối chiếu profile/XML với bản TCVN 12687:2019 và QCVN dự án có bản quyền.
2. Chạy k6 staging thật, ghi p95/RPS/error.
3. Chạy PostgreSQL/MinIO restore drill native VPS, ghi RPO/RTO.
4. Cấu hình Prometheus/Grafana systemd; test alerts.
5. Pentest độc lập; High/Critical = 0.