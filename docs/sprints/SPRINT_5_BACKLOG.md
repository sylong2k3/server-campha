# Sprint 5 — CMS tin tức, văn bản, bản đồ PDF

## Sprint goal

Cùng REST API phục vụ web/mobile: quản trị và đọc tin tức, bình luận kiểm duyệt, kho văn bản/báo cáo, bản đồ PDF; file private MinIO qua presigned URL ngắn hạn.

## Stories

| Story | Phạm vi | Trạng thái |
|---|---|---|
| US-5.1 | CRUD/search/pagination tin tức | Done kỹ thuật |
| US-5.2 | Tin công khai, bình luận login-only, kiểm duyệt | Done kỹ thuật |
| US-5.3 | PDF/DOC/DOCX/XML đã scan + mã số/cơ quan | Done kỹ thuật; live ClamAV/MinIO UAT deferred |
| US-5.4 | Public/internal document ACL tại SQL | Done kỹ thuật |
| US-5.5 | PDF map metadata + view/download RBAC | Done kỹ thuật; live file UAT deferred |
| US-5.6 | REST contracts dùng chung mobile | Done API; mobile app ngoài server scope |

## Security controls

- `visibility` được lọc tại repository SQL; private content trả 404 khi không có quyền.
- News content dùng plain text/Markdown; comment từ chối `<`/`>` và lưu plain text.
- Comments mặc định `pending`; chỉ role có `news.update` kiểm duyệt.
- Comment rate limit: 10 request / 15 phút.
- File CMS phải là `core.file_objects` owner-owned, category `documents`, `ready`, đã scan.
- XML cấm `DOCTYPE`/`ENTITY`; PDF map kiểm tra extension + detected MIME.
- Không trả bucket/object key; URL MinIO ký 60–900 giây.
- Admin update/delete dùng optimistic `updated_at`.

## Acceptance evidence

```text
Migration 000–010:         applied/checksum OK on campha_test
ESLint:                    passed
Unit:                      144 passed; 6 GDAL-local skipped
Integration:               30 passed (PostgreSQL/PostGIS + Supertest)
Global branch coverage:    78.85%
CMS service branches:      94.11%
Production npm audit:      0 vulnerabilities
Postman/runtime:           parsed/imported successfully
API contract policy:       OpenAPI retired in Sprint 6a; Postman retained
Postman secret check:      passed; testPassword empty
Git diff check:            passed
```

## Deferred

- Production `campha`: chưa áp migrations `007–010`.
- Live upload/download UAT cần MinIO private + `clamd` bật + file PDF/DOC/XML thật.
- UI CMS và mobile app không thuộc repository server này.

## Trạng thái

Sprint 5 **Done kỹ thuật có điều kiện**. Các gate còn lại đều thuộc deployment/live-service hoặc client UI; không chặn sprint backend kế tiếp.