# Security Policy

## Phiên bản hỗ trợ

Nhánh `develop` và release mới nhất trên `main` được nhận bản vá bảo mật.

## Báo cáo lỗ hổng

Không mở issue công khai. Gửi riêng cho phụ trách an toàn thông tin của dự án, gồm:

- endpoint/module bị ảnh hưởng;
- điều kiện tái hiện tối thiểu;
- mức ảnh hưởng tới dữ liệu, tài khoản hoặc hạ tầng;
- log đã loại bỏ token, mật khẩu và dữ liệu cá nhân.

Mục tiêu phản hồi: Critical 4 giờ, High 1 ngày làm việc, Medium 3 ngày làm việc.

## Quy tắc bắt buộc

- Không commit `.env`, token, khóa dịch vụ hoặc tài khoản VPS.
- Thay toàn bộ mật khẩu seed trước production.
- GeoServer, MinIO, Redis, PostgreSQL chỉ bind private/local interface; Nginx là cửa vào công khai.
- Hợp đồng API duy trì duy nhất trong Postman collection; runtime không phục vụ `/api/docs`.
- Không sửa migration đã chạy; chỉ tạo migration forward-only.
- Mọi endpoint ghi/xóa phải có RBAC, organization scope và audit log.
- Lỗ hổng High/Critical phải được xử lý trước release.

## Quét định kỳ

```bash
npm run lint
npm test -- --runInBand
npm run security:audit
```

Semgrep và gitleaks chạy trong CI. Advisory không có bản vá upstream phải được ghi nhận, đánh giá bề mặt khai thác và theo dõi nâng cấp.
