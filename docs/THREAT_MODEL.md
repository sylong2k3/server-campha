# Threat Model — Baseline Sprint 2

## Tài sản cần bảo vệ

- JWT/refresh token và mật khẩu người dùng.
- Dữ liệu đa tổ chức trong PostgreSQL/PostGIS.
- Lớp bản đồ, raster và tài liệu trên MinIO/GeoServer.
- Credential VPS, Google Earth Engine, Firebase và SMTP.
- Cơ chế job nền tương lai và nhật ký kiểm toán.

## Ranh giới tin cậy

```mermaid
flowchart LR
  Client[Web/Mobile/Operator] --> Nginx[Nginx TLS]
  Nginx --> API[Node API via PM2]
  API --> DB[(PostgreSQL/PostGIS)]
  API --> MinIO[(MinIO)]
  API --> GeoServer[GeoServer private]
  Worker[Future DB Queue Worker] --> DB
  Worker --> MinIO
```

Nginx là ingress công khai duy nhất. DB, MinIO và GeoServer là dịch vụ native VPS, chỉ bind local/private interface. Redis chưa được dùng.

## Mối đe dọa chính

| Mối đe dọa | Kiểm soát hiện tại | Tiếp theo |
|---|---|---|
| Bypass/leo thang RBAC | Permission từ DB, không bypass `system_admin`, test hồi quy | Sinh test theo toàn ma trận |
| IDOR xuyên tổ chức | `org_id` ép ở service/repository | Integration test DB thật |
| Truy cập lớp trái phép | `gis.layer_permissions`; WMS ép tên layer từ DB; WFS chỉ `GetFeature` qua ACL `export` | Đóng WMS/WFS trực tiếp tại firewall/GeoServer theo lịch vận hành |
| Brute force/token replay | Rate limit, token blacklist, refresh rotation/reuse detection | MFA/LDAP giữ feature flag tắt đến UAT |
| Migration chạy đồng thời/bị sửa | Advisory lock, SHA256 checksum, transaction từng file | Backup/restore drill |
| Upload độc hại/zip bomb | Presigned PUT chỉ vào quarantine; allow-list extension; magic bytes; size limit; ClamAV INSTREAM fail-closed; SHA-256 trước promote | Bật `clamd` native và UAT malware thật; ZIP entry/decompression limits ở Sprint 3 import |
| SSRF/redirect qua GeoServer | Base URL chỉ từ server config; path nội bộ; resource identifier validation; `redirect: error`; sanitized upstream errors | Outbound firewall allow-list |
| Lộ object storage | 5 bucket private; anonymous request trả 403; empty anonymous policy; download URL ngắn hạn theo owner | TLS/đóng cổng MinIO theo lịch vận hành |
| Queue replay/trùng job | Chưa có queue nghiệp vụ | Khi có job dài: PostgreSQL `FOR UPDATE SKIP LOCKED` + idempotency; chỉ thêm Redis nếu đo được nút nghẽn |
| Lộ secret | `.env` ignored; credential MinIO/GeoServer đọc từ `.secrets/`; `.env.example` chỉ chứa path | Secret manager/rotation production |
| Xóa log che dấu hành vi | Cleanup yêu cầu DB permission, ghi audit riêng | WORM/export log production |

## Giả định cần kiểm tra

- MinIO và GeoServer hiện vẫn có cổng reachable; người vận hành đã quyết định đóng sau. Đây là residual risk được chấp nhận tạm thời, không phải trạng thái production-ready.
- WFS/WMS trực tiếp hiện reachable; Node proxy đã read-only/ACL nhưng không thay thế firewall gate.
- `CLAMAV_ENABLED=false` đến khi `clamd` native được cài và UAT; vì fail-closed nên commit upload sẽ trả 503 khi scanner chưa bật.
- Nginx truyền đúng client IP và `TRUST_PROXY` được cấu hình chính xác.
- Mật khẩu seed bị đổi hoặc tài khoản seed bị xóa trước production.
