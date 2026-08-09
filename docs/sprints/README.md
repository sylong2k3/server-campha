# Ma trận Chuẩn hóa các Sprint — Dự án Cẩm Phả WebGIS & Mobile GIS

Tài liệu này tổng hợp toàn bộ 14 Sprint của dự án Cẩm Phả WebGIS & Mobile GIS, bao gồm trạng thái nghiệm thu, nội dung cốt lõi và định hướng triển khai.

## Tổng quan trạng thái 14 Sprints

| Sprint | Tên Sprint / Phân hệ | Trạng thái | Ghi chú |
|---|---|---|---|
| **Sprint 1** | Khung nền tảng Server & Auth | **ĐÃ NGHIỆM THU (100%)** | Auth JWT, Refresh token, Bcrypt, Argon2id, RBAC 6 vai trò, Security Headers |
| **Sprint 2** | Quản lý Người dùng & Audit Logs | **ĐÃ NGHIỆM THU (100%)** | CRUD User, Đổi mật khẩu bắt buộc, Sessions, Activity Logs |
| **Sprint 3** | Lưu trữ Tệp & Quản lý Lớp Bản đồ | **ĐÃ NGHIỆM THU (100%)** | MinIO Object Storage, ClamAV Antivirus, Import Shapefile/Excel, Layer Metadata |
| **Sprint 4** | WebGIS Catalog & Map Proxy Dịch vụ | **ĐÃ NGHIỆM THU (100%)** | WebGIS Catalog, GeoServer WMS/WFS Proxy, Legend, Attribute Query |
| **Sprint 5** | Cổng thông tin (CMS) & Bản đồ PDF | **ĐÃ NGHIỆM THU (100%)** | CMS Tin tức, Bình luận, Văn bản pháp lý, Bản đồ PDF tĩnh |
| **Sprint 6a** | Danh mục Ảnh Vệ tinh Viễn thám | **ĐÃ NGHIỆM THU (100%)** | Quản lý Ảnh Vệ tinh (Sentinel/Landsat), Phân nhóm chuyên đề, Metadata |
| **Sprint 7** | Phân tích Thống kê Không gian | **ĐÃ NGHIỆM THU (100%)** | Spatial Statistics Source (Polygon), Re-calc diện tích PostGIS, So sánh đa thời gian |
| **Sprint 8** | Phản ánh Hiện trường (Field Reports) | **ĐÃ NGHIỆM THU (100%)** | Gửi phản ánh hiện trường (Ảnh, Vị trí GPS), Xử lý phản ánh, Push Token |
| **Sprint 9a** | Mobile GIS: Xem, Định vị & Vẽ phác thảo | **ĐÃ NGHIỆM THU (100%)** | Vector Tile MVT (`ST_AsMVT`), GPS Nearby, Đo chiều dài/diện tích VN-2000 |
| **Sprint 9b** | Mobile GIS: Tìm đường & Biên tập | **ĐÃ NGHIỆM THU (100%)** | pgRouting Dijkstra, Topology check, Version History/Restore, Offline Sync |
| **Sprint 10** | **Bản đồ Chuyên đề & Chỉ số Hệ thống** | **THAY ĐỔI YÊU CẦU MỚI** | Lựa chọn/tra cứu danh mục chỉ số → Trỏ ra Lớp bản đồ (Vector/Raster/MVT/WMS) tương ứng |
| **Sprint 11** | Tham số Mô hình Thủy văn – Thủy lực | **SẮN SÀNG TIẾP NHẬN** | Gắn tham số mô hình thủy văn/thủy lực (SCS-CN, Horton, Manning n) theo bộ chỉ số |
| **Sprint 12** | Điều phối & Chạy Mô hình Dự báo Ngập | **SẮN SÀNG TIẾP NHẬN** | Điều phối chạy engine mô phỏng, sinh bản đồ ngập dự báo, cảnh báo vượt ngưỡng |
| **Sprint 13** | API Registry & Tích hợp Bên thứ ba | **ĐÃ NGHIỆM THU (100%)** | API Key Registry, Rate Limiting theo Key, Field Allowlist, Revocation/Delete |
| **Sprint 14** | Tối ưu Hiệu năng, Security & Handoff | **ĐÃ NGHIỆM THU (100%)** | Benchmark MVT/WMS <100ms, Security Audit 0 vulnerability, Handoff documentation |

---

## Chi tiết Định hướng Sprint 10 (Mới)

- **Input:** Danh mục chỉ số chuyên đề (chỉ số mưa, chỉ số mực nước, nguy cơ ngập, chất lượng không khí AQI...).
- **Xử lý:** Ánh xạ linh hoạt từ chỉ số được chọn sang 1 hoặc nhiều lớp bản đồ GIS.
- **Output:** Danh sách các lớp bản đồ tương ứng (WMS URL, MVT Tile URL, GeoJSON) hiển thị trực tiếp trên WebGIS và Mobile GIS.
