# Runbook vận hành LDAP/Active Directory

## Mô hình bảo mật

- AD xác thực username/password qua **LDAPS**.
- PostgreSQL quyết định role và organization.
- API phát JWT access/refresh sau khi cả AD và local policy đạt.
- Mật khẩu người dùng chỉ tồn tại trong request memory đến lúc `bind()`; không lưu DB/log.
- Account LDAP không có local password fallback, password reset hoặc Google auto-link.

## Chuẩn bị phía Active Directory

1. Tạo service account `svc_campha_ldap` chỉ có quyền đọc directory; không Domain Admin.
2. Chọn Base DN/User OU hẹp nhất chứa cán bộ được phép provision.
3. Cấp certificate LDAPS cho Domain Controller. SAN phải chứa hostname trong `LDAP_URL`.
4. Export CA chain dạng PEM; không dùng certificate DC tự ký không quản lý.
5. Chốt thuộc tính:
   - Login: `sAMAccountName`.
   - Stable identity: `objectGUID`.
   - Profile: `mail`, `displayName`.
6. Ghi nhận domain lockout threshold/window/duration. Đặt `LDAP_MAX_LOGIN_ATTEMPTS` thấp hơn AD threshold.

## Mạng VPS

1. Kết nối VPS đến DC qua VPN/private network.
2. Firewall chỉ cho app VPS outbound đến private DC host port `636`.
3. Không publish port 636 DC ra Internet.
4. Kiểm tra DNS hostname resolve đúng private IP.
5. Kiểm tra certificate chain và hostname:

```bash
openssl s_client -connect dc01.example.local:636 -servername dc01.example.local -CAfile /etc/campha/certs/ad-ca.pem -verify_return_error
```

## Secrets trên VPS

```bash
sudo install -o campha -g campha -m 0600 /dev/null /etc/campha/secrets/ldap-bind-password
sudo install -o campha -g campha -m 0640 ad-ca.pem /etc/campha/certs/ad-ca.pem
```

- Ghi bind password vào file bằng secret deployment mechanism; không command history, Git hoặc PM2 config công khai.
- `.env` chỉ chứa đường dẫn file.
- Rotate service password theo chính sách; cập nhật file atomically; restart PM2; chạy UAT.

## Deploy

1. Backup DB test.
2. Deploy code với `LDAP_ENABLED=false`.
3. Chạy migration `005` trên `campha_test`.
4. Chạy lint/unit/coverage/integration.
5. Cấu hình LDAPS staging.
6. Bật `LDAP_ENABLED=true` staging; restart PM2.
7. Provision account qua API admin với `authProvider=ldap`, `directoryUsername`, role đã duyệt.
8. Chạy UAT dưới đây.
9. Sau phê duyệt mới migrate `campha`, canary production, bật flag.

## UAT bắt buộc

| Case | Kết quả |
|---|---|
| Active + đúng password | JWT access/refresh; role/org từ PostgreSQL |
| Sai password | Generic `401`; không lộ user tồn tại |
| User không tồn tại/chưa provision | Cùng generic `401` |
| Disabled/expired | Generic `401` |
| Vượt app threshold | Local progressive lock; AD threshold chưa chạm |
| CA/hostname sai | `503`; không fallback; không consume refresh |
| DC timeout/down | `503`; không tính wrong password |
| Disable sau login | Refresh bị thu hồi; access cũ tối đa 15 phút |
| Local `/auth/login` cùng email | `401`; không bypass AD |
| Forgot/reset/admin reset password | Không tạo local password |
| Google cùng email | Không auto-link |
| Cross-org/role escalation | `403` |

Không gửi password UAT qua chat/email. Dùng password manager/secret channel của đơn vị.

## Giám sát

- Theo dõi tỷ lệ `/auth/ldap/login`: `401`, `429`, `503`; không log request body.
- Theo dõi account lock bất thường/password spraying.
- Domain Controller Event Viewer:
  - Event `2887`: thống kê bind không an toàn.
  - Event `2889`: client thực hiện bind không an toàn.
  - Mục tiêu: không có bind cleartext/unsigned từ VPS.
- Audit local phải có user ID khi đã link, provider `ldap`; không có DN/password/raw AD diagnostic.

## Incident và rollback

### AD outage

- Giữ fail closed cho LDAP login/refresh.
- Không bật local password cho LDAP identities.
- Local break-glass `system_admin` chỉ dùng xử lý sự cố, được niêm phong và audit.
- Access token đã cấp hết hạn tối đa 15 phút.

### Rollback app

1. Đặt `LDAP_ENABLED=false`.
2. Restart PM2.
3. LDAP users tạm ngừng đăng nhập; không đổi họ sang local password.
4. Migration `005` giữ nguyên; không drop identity data.

### Rotate bind secret

1. Tạo password mới trong AD.
2. Ghi file secret mới atomically, owner/mode đúng.
3. Restart một instance PM2 canary.
4. UAT service search + user login.
5. Restart phần còn lại; theo dõi `503`.
