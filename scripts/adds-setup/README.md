# Dựng AD DS + LDAPS cho server-campha

Bộ script dựng một forest Active Directory mới trên Windows Server 2022 và bật LDAPS,
khớp với cấu hình mà [src/configs/ldap.js](../../src/configs/ldap.js) yêu cầu:
`ldaps://` bắt buộc, verify certificate chain, thuộc tính `sAMAccountName` / `objectGUID` / `mail` / `displayName`.

Bổ sung cho [docs/LDAP_AD_RUNBOOK.md](../../docs/LDAP_AD_RUNBOOK.md) — runbook mô tả vận hành,
bộ script này lo phần dựng hạ tầng.

## Trước khi chạy

1. Copy cả thư mục `adds-setup` sang Windows Server 2022 (vd `C:\adds-setup`).
2. **Sửa `config.ps1`** — nhất là `$DomainName`, `$IPAddress`, `$AppVpsAddress`.
   Tên domain và NetBIOS **không đổi được** sau khi promote.
3. Mở PowerShell **Run as Administrator**.
4. Cho phép chạy script trong phiên hiện tại:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## Thứ tự chạy

| Script | Việc | Restart |
|---|---|---|
| `01-prepare-host.ps1` | Cấu hình card private, đổi tên máy | Có |
| `02-install-adds.ps1` | Cài AD DS, tạo forest | Có |
| `03-create-objects.ps1` | DNS về chính DC, OU, service account, user test | Không |
| `04-enable-ldaps.ps1` | AD CS, cert cho DC, LDAP signing, firewall 636 | Restart NTDS |
| `07-harden-multihomed-dc.ps1` | **Chạy ở đây** nếu DC có card public | Restart DNS |
| `05-export-ca.ps1` | Xuất `ad-ca.pem`, sinh block `.env` | Không |
| `06-verify-ldaps.ps1` | Bind + search thật qua LDAPS | Không |

Mỗi script idempotent — chạy lại được nếu bị gián đoạn.

## Kiến trúc mạng

DC có hai card, mỗi card một vai trò tách bạch:

| Card | Vai trò | Default gateway | DNS registration |
|---|---|---|---|
| Private (`$PrivateInterfaceAlias`) | AD, DNS, LDAPS — VPS app kết nối vào đây | Không | Có |
| Public (`$PublicInterfaceAlias`) | Chỉ RDP + Windows Update | Có | **Tắt** |

Ba cái bẫy của DC multi-homed mà script đã xử lý:

1. **DC tự đăng ký cả hai IP vào DNS zone.** Client phân giải trúng IP public sẽ kết nối
   sai đường hoặc timeout. `01` tắt registration trên card public, `07` gỡ record public còn sót.
2. **Hai default gateway gây routing loạn.** `01` không đặt gateway trên card private và
   cảnh báo nếu phát hiện nhiều hơn một.
3. **DNS server lắng nghe trên mọi IP.** `07` ép `dnscmd /ResetListenAddresses` về IP private.

## DNS: tên phải khớp ba nơi

Hostname trong `LDAP_URL`, FQDN của DC, và SAN của certificate **phải giống hệt nhau** —
app bật `rejectUnauthorized: true` nên lệch một ký tự là fail.

Với `$DomainName = 'ad.campha.vn'` và `$ServerName = 'DC01'`:

| Nơi | Giá trị |
|---|---|
| FQDN của DC | `dc01.ad.campha.vn` |
| SAN của certificate | `dc01.ad.campha.vn` (DC tự enroll) |
| `LDAP_URL` | `ldaps://dc01.ad.campha.vn:636` |
| Phân giải trên VPS app | → **IP private** của DC |

Dùng private network thì **không cần record DNS public nào**. Trên VPS app ghi thẳng:

```bash
echo "10.104.0.10 dc01.ad.campha.vn" | sudo tee -a /etc/hosts
```

Gọn hơn public DNS và không tiết lộ vị trí DC cho ai quét.

## Kết quả

Sau `05-export-ca.ps1`, trong `C:\campha-ldap`:

- `ad-ca.pem` — CA chain, copy sang VPS thành `/etc/campha/certs/ad-ca.pem`
- `ldap.env.snippet` — block `.env` đã điền sẵn Base DN / Bind DN / URL

## Chuyển sang VPS

```bash
sudo install -o campha -g campha -m 0640 ad-ca.pem /etc/campha/certs/ad-ca.pem
```

```bash
sudo install -o campha -g campha -m 0600 /dev/null /etc/campha/secrets/ldap-bind-password
```

Ghi bind password vào file bằng cơ chế secret deployment của đơn vị — không qua
command history, không commit vào Git, không để trong PM2 config.

Kiểm tra từ VPS trước khi bật flag:

```bash
openssl s_client -connect dc01.ad.campha.vn:636 -servername dc01.ad.campha.vn -CAfile /etc/campha/certs/ad-ca.pem -verify_return_error
```

Phải thấy `Verify return code: 0 (ok)`.

## Nguyên tắc bảo mật đã nhúng trong script

- Service account `svc_campha_ldap` chỉ có quyền đọc mặc định, không thuộc group đặc quyền;
  script cảnh báo nếu phát hiện ngược lại.
- Firewall chỉ mở TCP 636 cho đúng IP VPS app. Không publish ra Internet.
- `LDAPServerIntegrity = 2` chặn simple bind cleartext trên port 389.
- Password (DSRM, service account, user) chỉ nhập tương tác qua `Read-Host -AsSecureString`,
  không ghi ra file, không vào command history.
- Script sinh `.env` với `LDAP_ENABLED=false`; chỉ bật sau khi UAT trong runbook đạt.

## Xử lý sự cố

| Triệu chứng | Xử lý |
|---|---|
| `04` báo không tìm thấy certificate | Enrollment chạy nền, đợi vài phút rồi chạy lại. Kiểm tra `certlm.msc` → Personal → Certificates |
| Port 636 không mở | `Restart-Service NTDS -Force`, đợi 30s, `Test-NetConnection localhost -Port 636` |
| `06` lỗi cert khi bind | SAN của cert không khớp hostname trong `LDAP_URL`; xem `$($cert.DnsNameList)` ở output script `04` |
| VPS báo `unable to verify the first certificate` | `ad-ca.pem` thiếu intermediate; chạy lại `05`, script tự nối chain khi phát hiện |
| Search trả về 0 entry | Base DN quá hẹp hoặc user nằm ngoài OU; app yêu cầu đúng 1 kết quả |
| Search trả về nhiều hơn 1 entry | Trùng `sAMAccountName` trong scope; thu hẹp Base DN |
| Event 2887/2889 trên DC | Có client bind không ký; rà lại xem còn gì dùng port 389 |
