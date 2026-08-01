# KẾ HOẠCH XÂY DỰNG HỆ THỐNG SERVER — WebGIS & MobileGIS TP CẨM PHẢ

> Nguồn yêu cầu: `Bang_chuc_nang_theo_quyen_Cam_Pha.docx` (Phụ lục bảng chức năng theo quyền).
> Nền tảng: Node.js 24 LTS (Express 5) · PostgreSQL 16 + PostGIS 3.4 · MinIO · GeoServer · Google Earth Engine.
> Quy trình: Agile Scrum, sprint 2 tuần.
> Ngày lập: 2026-07-31.

---

## MỤC LỤC

- [Phần A. Phạm vi & phân tích khoảng cách](#phần-a-phạm-vi--phân-tích-khoảng-cách)
- [Phần B. Kiến trúc hệ thống](#phần-b-kiến-trúc-hệ-thống)
- [Phần C. Thiết kế dữ liệu](#phần-c-thiết-kế-dữ-liệu)
- [Phần D. Thiết kế phân quyền](#phần-d-thiết-kế-phân-quyền)
- [Phần E. Quy trình Agile Scrum](#phần-e-quy-trình-agile-scrum)
- [Phần F. Roadmap 23 sprint](#phần-f-roadmap-23-sprint)
- [Phần G. Bảo mật](#phần-g-bảo-mật)
- [Phần H. Chiến lược kiểm thử](#phần-h-chiến-lược-kiểm-thử)
- [Phần I. DevOps & vận hành](#phần-i-devops--vận-hành)
- [Phần J. Rủi ro & điểm cần chốt](#phần-j-rủi-ro--điểm-cần-chốt)

---

# Phần A. Phạm vi & phân tích khoảng cách

## A.1. Tổng hợp phạm vi từ tài liệu

| Phân hệ | Số module | Mã tham chiếu |
|---|---|---|
| Quản trị WebGIS (back-end) | 10 | A.1-1 … A.1-10 |
| Người dùng WebGIS (front-end) | 11 | A.2-1 … A.2-11 |
| Mobile GIS | 6 | B-1 … B-6 |
| **Tổng** | **27 module** | ~150 chức năng con |

Phân bổ theo độ phức tạp do tài liệu tự đánh giá:

| Độ phức tạp | Module | Ước lượng story point (thang Fibonacci, team 5 người) |
|---|---|---|
| Phức tạp | A.1-9, A.1-10, A.2-1, A.2-2, B-1 | 40–80 SP/module |
| Trung bình | A.1-1, A.1-2, A.1-3, A.1-5, A.2-3, A.2-5, A.2-6, A.2-7 | 20–34 SP/module |
| Đơn giản | A.1-4, A.1-6, A.1-7, A.1-8, A.2-4, A.2-8, A.2-9, A.2-10, A.2-11, B-2…B-6 | 8–13 SP/module |

## A.1b. Tải trọng theo sprint và cơ sở của con số 23 sprint

Rải khối lượng trên sang từng sprint (velocity cam kết 40 SP/sprint với 10% dự phòng trong sprint):

| Sprint | Nội dung | SP | Tỷ lệ tải |
|---|---|---:|---|
| S0 | Nền tảng & chuẩn hóa | 40 | 1,0× |
| S1 | Auth + quản trị người dùng + MFA | 50 | 1,25× ⚠ |
| S2 | Hạ tầng dữ liệu không gian + COG spike | 45 | 1,1× |
| S3 | Quản trị lớp bản đồ + Hiệu chỉnh Velocity | 50 | 1,25× ⚠ |
| S4 | WebGIS front-end API | 58 | 1,45× ⚠ |
| S5 | CMS | 60 | 1,5× ⚠ |
| S6a/S6b | Ảnh vệ tinh + GEE (tách đôi) | 85 | 1,06× (avg) |
| S7 | Phân tích không gian, thống kê | 43 | 1,1× |
| S8 | Phản ánh cộng đồng + realtime + SPIKE-8.8 | 55 | 1,35× ⚠ |
| S9a/S9b | Mobile GIS core (tách đôi) | 73 | 0,91× (avg) |
| S10a/S10b | KTTV trực tuyến 7.7 (tách đôi) | 80 | 1,0× (avg) |
| S11 | Tham số thủy văn–thủy lực (7.6) | 45 | 1,1× |
| S12 | Chạy mô hình + dự báo ngập | 48 | 1,2× ⚠ |
| S12b | Sprint đệm hấp thụ carry-over | 0 | 0,0× |
| S13 | Registry API | 40 | 1,0× |
| S14 | Siêu dữ liệu, hiệu năng, gia cố | 40 | 1,0× |
| S15 | UAT tổng thể & bàn giao | 0 | 0,0× |
| | **Tổng** | **812** | |

**812 SP / 40 = 20,3 → 21 sprint phát triển (gồm 6a/6b, 9a/9b, 10a/10b) + 1 sprint đệm (S12b) + 1 sprint UAT (S15) = 23 sprint × 2 tuần ≈ 10,5–11 tháng.**

### ⚠ Độ tin cậy của con số này

Đây là phép chia trong đó **cả tử số lẫn mẫu số đều là giả định**, không phải số đo:

| Yếu tố | Vấn đề |
|---|---|
| Velocity 40 SP/sprint | Do người lập kế hoạch đặt ra (đã tính 10% dự phòng trong sprint). Đội **chưa chạy sprint nào** nên chưa có velocity thật để căn. |
| 812 SP | Quy đổi từ nhãn "Đơn giản / Trung bình / Phức tạp" trong tài liệu yêu cầu — do **người viết đặc tả** gán, không phải đội sẽ viết code. Scrum quy định Development Team tự ước lượng vì chỉ họ biết chỗ nào khó. |
| Chi phí DoD | Các nhãn trên chắc chắn **không tính** phủ nhánh 75% + test phân quyền 7 tác nhân (5 role DB, KH anonymous, GEE service account) tự động cho mọi endpoint liên quan (E.4). Đây là chi phí thật, hiện chưa nằm trong 812 SP. |

**Cách đọc đúng: 23 sprint là điểm giữa của khoảng 19–27 sprint (±20%).** Không cam kết mốc 10,5 tháng cố định với chủ đầu tư dựa trên con số này.

**Mốc hiệu chỉnh bắt buộc — cuối Sprint 3 (US-3.8):** khi đã có 3 điểm velocity thật (S1, S2, S3), Scrum Master tính lại velocity trung bình, đội ước lượng lại toàn bộ backlog còn tồn theo Planning Poker, và **thay thế bảng trên bằng số thật**. Trước mốc này, mọi trao đổi về tiến độ với chủ đầu tư phải nêu kèm biên độ ±20%.

### Dự phòng

Kế hoạch 23 sprint sử dụng hai lớp dự phòng:

1. **Dự phòng trong sprint — 10% năng lực.** Chỉ cam kết **40 SP/sprint** (so với năng lực lý thuyết 45 SP). Phần 10% dùng cho lỗi phát sinh, hỗ trợ sự cố, và việc chen ngang.
2. **Sprint đệm — S12b, chèn sau S12.** Không có story nào được lên lịch trước. Dùng để hấp thụ carry-over dồn từ S4/S5/S8 (các sprint ở mức 1,3–1,5×) và rủi ro của nhánh thủy lực. Nếu không dùng đến thì kéo hạng mục từ S14 lên.

**Sau khi tính dự phòng: 23 sprint × 2 tuần ≈ 10,5–11 tháng**, biên độ 19–27 sprint.

Ba sprint ở mức 1,6–1,9× năng lực (S6, S9, S10) được **tách đôi** trong Phần F thành 6a/6b, 9a/9b, 10a/10b để phản ánh đúng thực tế thay vì dồn dập công việc.

**Không rút sprint xuống 1 tuần.** Công việc GIS có vòng phản hồi dài (import dữ liệu thật, chờ job GEE, chờ chuyên gia thủy văn xác nhận kết quả hiệu chỉnh); một tuần không đủ để đóng story theo DoD ở mục E.4.

## A.2. Hiện trạng codebase `server-campha`

Đã có (giữ lại, mở rộng):

| Thành phần | File | Trạng thái |
|---|---|---|
| Express app + middleware chain | `src/app.js`, `server.js` | Dùng được |
| Xác thực JWT + refresh + blacklist jti | `src/services/auth.service.js`, `src/utils/tokenManager.util.js` | Dùng được; hỗ trợ local password + Google OAuth; LDAP/AD đã retire |
| RBAC theo `permissions` JSONB | `src/middlewares/auth.middleware.js` | **Đã bỏ bypass `system_admin`; mọi role dùng quyền DB** |
| Social login (Google) | `src/configs/passport.js` | Dùng được |
| Schema nền `core`, `auth`, `gis.layers`, ACL lớp | migrations `000`–`002` | Dùng được; nghiệp vụ GIS khác xây tiếp theo sprint |
| Migration runner | `src/database/migrate.js` | Dùng được local, cần hardening production (I.3) |
| Nhật ký hệ thống | `src/services/systemLog.service.js` (chưa commit) | Hoàn thiện trong Sprint 0 |
| Connector MinIO | `src/configs/minioClient.js`, `src/services/minio.service.js` | Mới ở mức kết nối |
| Connector GeoServer | `src/configs/geoserver.js`, `src/utils/geoserver.client.js` | Mới ở mức kết nối |
| Connector GEE | `src/configs/gge.js` | Mới ở mức kết nối |
| Connector thời tiết | `src/utils/openweather.client.js` | Mới ở mức kết nối |
| WebSocket | `src/realtime/websocket.server.js` (dùng `ws`) | Tài liệu yêu cầu Socket.io — cần chốt |
| Push FCM | `src/utils/pushProvider.util.js` | Dùng được |
| i18n vi/en | `src/utils/i18n.util.js` | Dùng được |

Chưa có (phải xây mới toàn bộ):

- Các schema nghiệp vụ còn lại: `raster`, `cms`, `field`, `hydro`, `kttv`, `apikey`; schema `gis` hiện mới có danh mục lớp và ACL nền.
- Import/publish dữ liệu không gian (shapefile, Excel, GeoJSON, GeoTIFF).
- Tích hợp thực chất GeoServer REST (tạo workspace/store/layer/style tự động).
- Hàng đợi tác vụ nền (job dài: GEE, mô hình thủy lực, thu thập KTTV).
- Registry API động + cấp phát khóa chia sẻ (A.1-5).
- Định tuyến đường đi ngắn nhất (pgRouting) cho B-1.
- Toàn bộ tầng mô hình thủy văn – thủy lực (A.1-9).

## A.3. Khoảng cách nghiêm trọng — trạng thái xử lý

| # | Khoảng cách ban đầu | Trạng thái hiện tại | Bằng chứng |
|---|---|---|---|
| G1 | Seed chỉ có 4 role cũ | **Đã xử lý** — 5 role đăng nhập `system_admin`, `ubnd_tp`, `so_tnmt`, `so_xd`, `citizen`; KH là anonymous, GEE là service account | `002_campha_foundation.sql`, `001_users.seed.js` |
| G2 | `system_admin` bypass mọi kiểm tra | **Đã xử lý** — bỏ bypass; mọi role kiểm tra `role_permissions` từ DB | `auth.middleware.js`, test hồi quy RBAC |
| G3 | Mô tả role còn nghiệp vụ cũ | **Đã xử lý runtime** — migration 002 ghi đè mô tả/quyền đúng Cẩm Phả; seed, i18n và README đã làm sạch. Migration 000 được giữ nguyên như lịch sử bất biến | `002_campha_foundation.sql` |
| G4 | Chưa có đa tổ chức | **Đã có nền** — `auth.organizations`, `users.org_id`; quản trị user bị giới hạn theo tổ chức | migration 002, `user.service.js`, `user.repository.js` |
| G5 | Chưa có ACL theo lớp | **Đã có nền** — `gis.layers`, `gis.layer_permissions`, `requireLayerAccess()`; gắn vào endpoint GIS khi triển khai Sprint 3 | migration 002, `layer-access.middleware.js` |

---

# Phần B. Kiến trúc hệ thống

## B.1. Sơ đồ thành phần

```
┌──────────────┐   ┌──────────────┐
│  WebGIS SPA  │   │ Mobile GIS   │
│  (Leaflet)   │   │ (Flutter/RN) │
└──────┬───────┘   └──────┬───────┘
       │  HTTPS/JWT       │
       └────────┬─────────┘
                ▼
      ┌───────────────────┐      ┌──────────────────┐
      │   Nginx / TLS     │◄─────┤  Chứng thư số    │
      │  reverse proxy    │      └──────────────────┘
      └─────────┬─────────┘
                │
   ┌────────────┼──────────────────────────┐
   ▼            ▼                          ▼
┌────────┐ ┌──────────┐            ┌──────────────┐
│ API    │ │ WebSocket│            │  GeoServer   │
│ Node.js│ │ realtime │            │ WMS/WFS/WMTS │
│Express5│ │          │            └───────┬──────┘
└───┬────┘ └────┬─────┘                    │
    │           │ LISTEN/NOTIFY            │
    │           │                          │
    ├───────────┴──────────────────────────┤
    ▼                                      ▼
┌──────────────────────┐          ┌──────────────────┐
│ PostgreSQL 16        │          │  MinIO (S3)      │
│ + PostGIS 3.4        │          │  ảnh, PDF, SHP,  │
│ + pgRouting          │          │  GeoTIFF, media  │
│ + postgis_raster     │          └──────────────────┘
└──────────────────────┘
    ▲
    │
┌───┴──────────┐   ┌──────────────┐   ┌─────────────────┐
│ Redis        │   │ Worker       │   │ Dịch vụ ngoài   │
│ cache/queue  │◄──┤ BullMQ       │──►│ GEE, KTTV, SMTP │
└──────────────┘   └──────────────┘   │ FCM             │
                                       └─────────────────┘
```

## B.2. Quyết định kiến trúc (ADR tóm tắt)

| ID | Quyết định | Lý do | Đánh đổi |
|---|---|---|---|
| ADR-01 | Monolith modular (không microservice) | Đội nhỏ, phạm vi 1 địa phương, giảm chi phí vận hành | Phải kỷ luật ranh giới module |
| ADR-02 | Không dùng ORM; giữ `pg` + repository pattern | Cần SQL không gian thô của PostGIS (ST_*, raster) mà ORM không diễn đạt tốt | Tự viết mapping |
| ADR-03 | Vector lưu trong PostGIS; raster lưu GeoTIFF/COG trên MinIO, GeoServer đọc qua ImageMosaic / S3 plugin | Raster trong DB phình dung lượng, khó backup | Cần đồng bộ metadata 2 nơi; thử nghiệm phương án đọc S3/sync volume ở Sprint 2 |
| ADR-04 | GeoServer chỉ phục vụ render bản đồ (WMS/WMTS); **WFS tắt mặc định**, mọi truy vấn thuộc tính và dữ liệu vector đi qua API Node | Kiểm soát phân quyền tập trung tại tầng API Node (tránh lộ toàn bộ hình học qua WFS) | Thêm 1 hop nhưng đảm bảo an ninh tuyệt đối |
| ADR-05 | Redis + BullMQ cho job dài; `node-cron` chỉ cho job nhẹ nội bộ | Job GEE/thủy lực chạy hàng chục phút, cần retry, tiến độ, idempotent | Thêm 1 hạ tầng |
| ADR-06 | Realtime: **chốt Socket.io** thay `ws` hiện tại | Tài liệu chỉ đích danh Socket.io; có room/namespace/fallback | Viết lại `src/realtime/` |
| ADR-07 | Cấp API chia sẻ (A.1-5) dùng JWT scope + API key có hạn mức, tách khỏi JWT người dùng | Chia sẻ liên ngành không nên dùng token phiên | Thêm bảng quản lý khóa |
| ADR-08 | Mô hình thủy văn–thủy lực: hệ thống **quản lý tham số + điều phối chạy**, engine tính toán là phần mềm chuyên dụng (SWMM/HEC-RAS) chạy qua worker | Viết lại engine thủy lực không khả thi trong 7 tháng | Phụ thuộc bên thứ ba |

## B.3. Cấu trúc thư mục mở rộng

```
src/
├── configs/          # database, minio, geoserver, gee, redis, queue
├── core/             # response, error, status code (đã có)
├── controllers/      # theo module: layer, raster, cms, field, hydro, kttv
├── services/         # nghiệp vụ
├── repositories/     # truy cập DB
├── validators/       # Joi schema
├── routes/
├── middlewares/
├── jobs/             # định nghĩa BullMQ queue + processor
│   ├── gee/          # phân loại ảnh, tải ảnh
│   ├── kttv/         # thu thập dữ liệu KTTV theo lịch
│   ├── hydro/        # chạy mô hình, hiệu chỉnh
│   └── geoserver/    # publish layer bất đồng bộ
├── geo/              # tiện ích không gian: shapefile reader, EPSG, topology
├── realtime/         # Socket.io + PG LISTEN/NOTIFY bridge
├── utils/
└── database/
    ├── migrations/
    └── seeds/
```

---

# Phần C. Thiết kế dữ liệu

## C.1. Danh sách schema

| Schema | Nội dung | Migration |
|---|---|---|
| `core` | hàm dùng chung, bảng cấu hình hệ thống, `system_logs` | 000, 001 |
| `auth` | tổ chức (tenant), người dùng, vai trò, token, nhật ký auth | 000, 002 |
| `gis` | danh mục lớp dữ liệu, ACL lớp, bảng dữ liệu không gian, metadata TT22 | 010–019 |
| `raster` | kho ảnh vệ tinh, cảnh ảnh, kết quả phân loại | 020–029 |
| `cms` | tin tức, bình luận, văn bản/báo cáo, bản đồ PDF | 030–039 |
| `field` | phản ánh người dân, ảnh hiện trạng, quy trình duyệt | 040–049 |
| `kttv` | nguồn dữ liệu, trạm, chuỗi số liệu, ngưỡng cảnh báo (Công việc 7.7) | 050–059 |
| `hydro` | kịch bản, bộ tham số theo phiên bản, lần chạy, chỉ tiêu kiểm định (Công việc 7.6) | 060–069 |
| `apikey` | API động cho lớp dữ liệu, khóa chia sẻ, hạn mức, nhật ký gọi | 070–079 |

Quy ước migration: đánh số 3 chữ số tăng dần, idempotent (`IF NOT EXISTS` / `DROP … IF EXISTS`), mỗi file một chủ đề, **không sửa file đã merge vào `main`**.

## C.2. Bảng trọng yếu (phác thảo)

### `auth.organizations` — đa tổ chức (giải quyết G4)

```sql
CREATE TABLE auth.organizations (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(30) UNIQUE NOT NULL,   -- 'ubnd_campha', 'so_tnmt_qn', 'so_xd_qn'
    name_vi     VARCHAR(200) NOT NULL,
    org_type    VARCHAR(30) NOT NULL,          -- 'ubnd' | 'so' | 'don_vi_van_hanh'
    parent_id   INT REFERENCES auth.organizations(id),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE auth.users ADD COLUMN org_id INT REFERENCES auth.organizations(id);
```

### `gis.layers` — danh mục lớp dữ liệu bản đồ (A.1-2)

```sql
CREATE TABLE gis.layers (
    id                BIGSERIAL PRIMARY KEY,
    code              VARCHAR(80) UNIQUE NOT NULL,   -- trùng tên layer trên GeoServer
    name_vi           VARCHAR(200) NOT NULL,
    category          VARCHAR(50),          -- nền địa lý / thủy hệ / giao thông / ...
    geometry_type     VARCHAR(20),          -- POINT | LINESTRING | POLYGON | RASTER
    srid              INT NOT NULL DEFAULT 4326,
    storage_kind      VARCHAR(20) NOT NULL, -- 'postgis' | 'geotiff_minio'
    table_name        VARCHAR(80),          -- khi storage_kind='postgis'
    object_key        TEXT,                 -- khi storage_kind='geotiff_minio'
    geoserver_layer   VARCHAR(120),
    style_name        VARCHAR(80),
    min_zoom          INT, max_zoom INT,    -- A.2-1(7) hiển thị theo tỷ lệ
    legend_config     JSONB DEFAULT '{}',   -- A.2-1(8) chú giải
    is_public         BOOLEAN NOT NULL DEFAULT false,
    metadata          JSONB DEFAULT '{}',   -- Chuẩn TCVN 12687:2019 + ISO 19115/19139
    version           INT NOT NULL DEFAULT 1,
    created_by        BIGINT REFERENCES auth.users(id),
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ACL theo lớp — giải quyết G5
CREATE TABLE gis.layer_permissions (
    layer_id   BIGINT NOT NULL REFERENCES gis.layers(id) ON DELETE CASCADE,
    role_code  VARCHAR(30) NOT NULL REFERENCES auth.roles(code),
    can_view   BOOLEAN NOT NULL DEFAULT false,
    can_export BOOLEAN NOT NULL DEFAULT false,
    can_edit   BOOLEAN NOT NULL DEFAULT false,
    can_delete BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (layer_id, role_code)
);
```

### `hydro.*` — Công việc 7.6

Bộ tham số của tài liệu (mục 4.1) gồm 6 nhóm, tổng ~45 tham số. Thiết kế lai:

```sql
CREATE TABLE hydro.scenarios (            -- kịch bản mô phỏng
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    rain_frequency_pct NUMERIC(5,2),      -- P = 1,2,5,10 %
    rain_duration_hours NUMERIC(6,2),
    rain_distribution VARCHAR(30),        -- SCS | Huff | thực đo
    urbanization_year INT,
    impervious_ratio_pct NUMERIC(5,2),
    tide_combination VARCHAR(50),
    sea_level_rise_cm NUMERIC(6,2),
    status VARCHAR(20) NOT NULL DEFAULT 'draft',  -- draft|calibrated|official
    created_by BIGINT REFERENCES auth.users(id),
    published_by BIGINT REFERENCES auth.users(id),  -- chỉ TNMT
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hydro.param_versions (       -- manifest quản lý phiên bản kịch bản
    id BIGSERIAL PRIMARY KEY,
    scenario_id BIGINT NOT NULL REFERENCES hydro.scenarios(id) ON DELETE CASCADE,
    version INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft | published | archived
    note TEXT,
    created_by BIGINT REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    UNIQUE (scenario_id, version)
);

CREATE TABLE hydro.param_sets (           -- bộ tham số chi tiết theo nhóm
    id BIGSERIAL PRIMARY KEY,
    param_version_id BIGINT NOT NULL REFERENCES hydro.param_versions(id) ON DELETE CASCADE,
    group_code VARCHAR(30) NOT NULL,      -- grid|hydrology|hydraulic|calibration|threshold
    params JSONB NOT NULL,                -- các tham số của nhóm, validate bằng JSON Schema
    UNIQUE (param_version_id, group_code)
);

CREATE TABLE hydro.runs (                 -- lần chạy mô hình
    id BIGSERIAL PRIMARY KEY,
    scenario_id BIGINT NOT NULL REFERENCES hydro.scenarios(id),
    param_version_id BIGINT NOT NULL REFERENCES hydro.param_versions(id), -- FK tới bản manifest đã khóa
    run_type VARCHAR(20) NOT NULL,        -- trial|calibration|validation|forecast
    status VARCHAR(20) NOT NULL,          -- queued|running|succeeded|failed
    job_id VARCHAR(64),                   -- BullMQ
    started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
    log_object_key TEXT,                  -- nhật ký lỗi/hội tụ trên MinIO
    result_object_key TEXT
);

CREATE TABLE hydro.metrics (              -- NSE, R2, PBIAS, RMSE
    run_id BIGINT NOT NULL REFERENCES hydro.runs(id) ON DELETE CASCADE,
    station_code VARCHAR(30), variable VARCHAR(30),
    nse NUMERIC(8,4), r2 NUMERIC(8,4), pbias NUMERIC(8,4), rmse NUMERIC(12,4),
    accepted BOOLEAN GENERATED ALWAYS AS (nse > 0.50) STORED,
    PRIMARY KEY (run_id, station_code, variable)
);
```

**Lý do dùng JSONB cho `params`:** 45 tham số phân nhóm, số lượng thay đổi theo phương pháp được chọn (SCS-CN / Horton / Green-Ampt là 3 tập tham số khác nhau). Ràng buộc kiểu và miền giá trị thực thi bằng **JSON Schema ở tầng validator**, không bằng cột SQL — tránh bảng 45 cột đa số NULL. Bù lại phải có test bao phủ mọi tổ hợp phương pháp.

### `kttv.*` — Công việc 7.7

```sql
CREATE TABLE kttv.sources (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    provider VARCHAR(200),                -- NCHMF, JAXA GSMaP, NASA GPM, ECMWF ERA5...
    service_type VARCHAR(20) NOT NULL,    -- REST|WMS|WMTS|WFS|WCS|GEE|FTP
    endpoint_url TEXT NOT NULL,
    auth_method VARCHAR(20),
    credential_enc BYTEA,                 -- MÃ HÓA, không bao giờ trả về API
    rate_limit_per_min INT, rate_limit_per_day INT,
    response_format VARCHAR(20),          -- JSON|GeoJSON|GeoTIFF|NetCDF|GRIB2|PNG
    license_note TEXT,
    spatial_config JSONB,                 -- bbox, clip layer, srid nguồn/đích, nội suy
    temporal_config JSONB,                -- chu kỳ, múi giờ, độ trễ, hạn lưu trữ
    variables JSONB,                      -- biến, đơn vị gốc, hệ số quy đổi, NoData, min/max
    display_config JSONB,                 -- thang màu, ngưỡng, độ trong suốt, z-index
    cron_expr VARCHAR(50),
    retry_count INT DEFAULT 3, retry_delay_sec INT DEFAULT 60,
    fallback_source_id BIGINT REFERENCES kttv.sources(id),
    is_enabled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE kttv.stations (
    code VARCHAR(30) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    station_type VARCHAR(30),             -- mưa|thủy văn|hải văn|khí tượng bề mặt
    geom GEOMETRY(Point, 4326) NOT NULL,
    elevation_m NUMERIC(8,2),
    managing_org VARCHAR(200),
    thiessen_weight NUMERIC(6,4),
    alarm_level_1_m NUMERIC(8,3),         -- cấp báo động I, II, III
    alarm_level_2_m NUMERIC(8,3),
    alarm_level_3_m NUMERIC(8,3),
    is_used_for_basin BOOLEAN DEFAULT true
);

-- Chuỗi số liệu trạm quan trắc (Point): phân mảnh theo tháng
CREATE TABLE kttv.observations (
    station_code VARCHAR(30) NOT NULL REFERENCES kttv.stations(code),
    variable VARCHAR(30) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    value NUMERIC(14,4),
    quality_flag SMALLINT NOT NULL DEFAULT 0,  -- 0 ok, 1 ngoài khoảng, 2 nhảy bậc, 3 mất tín hiệu
    source_id BIGINT REFERENCES kttv.sources(id)
) PARTITION BY RANGE (observed_at);

-- Dữ liệu KTTV dạng lưới/raster (GSMaP, GPM, ERA5, NetCDF, GeoTIFF)
CREATE TABLE kttv.grid_assets (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES kttv.sources(id),
    variable VARCHAR(50) NOT NULL,
    valid_at TIMESTAMPTZ NOT NULL,
    bbox GEOMETRY(Polygon, 4326),
    resolution_deg NUMERIC(8,5),
    object_key TEXT NOT NULL,
    checksum VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kttv_grid_valid_at ON kttv.grid_assets (valid_at);
```

## C.3. Chỉ mục không gian & hiệu năng

- Mọi cột `geometry` → `CREATE INDEX … USING GIST (geom)`.
- Bảng lớn (`kttv.observations`, `field.reports`) → partition theo tháng, `BRIN` trên cột thời gian.
- Vật liệu hóa thống kê ngập theo phường/xã (`A.2-3`) bằng `MATERIALIZED VIEW`, refresh sau mỗi lần chạy mô hình.
- Truy vấn A.2-4 (so sánh diện tích ngập 2 thời điểm) dùng `ST_Intersection` + `ST_Area(geography)`, luôn ép về EPSG chuẩn trước khi tính diện tích.
- **Hệ tọa độ:** lưu trữ EPSG:4326; tính toán diện tích/khoảng cách chuyển sang VN-2000 múi 3°, kinh tuyến trục 107°45′ (đăng ký custom SRID trong `spatial_ref_sys`).

---

# Phần D. Thiết kế phân quyền

## D.1. Ánh xạ 7 tác nhân sang vai trò hệ thống

| Mã tài liệu | `auth.roles.code` mới | Ghi chú |
|---|---|---|
| KH — Khách | *(không có bản ghi)* | Endpoint công khai, `optionalAuth` |
| ND — Người dân | `citizen` | Tự đăng ký |
| UB — UBND TP Cẩm Phả | `ubnd_tp` | **Không** có quyền quản trị người dùng; không sửa dữ liệu |
| TNMT — Sở TN&MT Quảng Ninh | `so_tnmt` | Toàn quyền (vai trò cao nhất theo tài liệu) |
| XD — Sở Xây dựng Quảng Ninh | `so_xd` | Toàn quyền trừ sửa/xóa lớp dữ liệu bản đồ |
| QT — Quản trị hệ thống | `system_admin` | **Trừ** phân quyền và sửa/xóa dữ liệu bản đồ |
| GEE — Google Earth Engine | *(service account)* | Không phải vai trò người dùng; quản lý qua `apikey` |

Migration `002_campha_foundation.sql` đổi `ubnd_tinh`→`ubnd_tp`, thay `so_nnmt`→`so_tnmt`, thêm `so_xd`, viết lại toàn bộ `description_vi/en` cho đúng ngữ cảnh ngập lụt Cẩm Phả (khắc phục G3), cập nhật `permissions` JSONB theo ma trận D.2, đồng thời tạo nền tổ chức và ACL lớp.

## D.2. Ma trận quyền rút gọn (trích các ô nhạy cảm)

| Hành động | KH | ND | UB | TNMT | XD | QT |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `layers:create` | – | – | – | ✔ | ✔ | ✔ |
| `layers:update` / `layers:delete` | – | – | – | ✔ | ✖ | ✖ |
| `layers:grant` (phân quyền lớp) | – | – | – | ✔ | ✖ | ✖ |
| `users:create/delete/lock/reset_password` | – | – | ✖ | ✔ | ✔ | ✔ |
| `users:change_role` (phân quyền tài khoản) | – | – | ✖ | ✔ | ✖ | ✖ |
| `raster:create/delete` | – | – | ✔ | ✔ | ✔ | ✔ |
| `api_registry:create/share` | – | – | – | ✔ | ✔ | ✔ |
| `api_registry:grant` | – | – | – | ✔ | ✖ | ✖ |
| `field_report:approve` | – | – | ✔ | ✔ | ✔ | ✖ |
| `hydro:edit_params` / `hydro:run` | – | – | ✖ | ✔ | ✔ | ✔ |
| `hydro:publish_scenario` | – | – | ✖ | ✔ | ✖ | ✖ |
| `kttv:display_config` | – | – | ✖ | ✔ | ✖ | ✖ |
| `kttv:alarm_threshold` | – | – | ✔ | ✔ | ✖ | ✖ |
| `map_feature:update` (mobile B-1(8)) | – | – | ✖ | ✔ | ✖ | ✖ |

Quyền `raster:create/delete` đã chốt theo mục 2.1 Nhóm chức năng quản trị: UB, TNMT, XD, QT được phép.

Ma trận đầy đủ 27 module × 7 tác nhân (5 role DB, KH anonymous, GEE service account) được duy trì trong `docs/MA_TRAN_PHAN_QUYEN.csv`, là **nguồn sự thật duy nhất** để sinh seed `permissions` JSONB và để sinh test phân quyền tự động (xem H.4).

## D.3. Sửa lỗ hổng leo thang đặc quyền (G2)

Hiện tại:

```js
// src/middlewares/auth.middleware.js:57
if (req.user.role === 'system_admin') { return next(); }   // bypass toàn bộ
```

Điều này trực tiếp mâu thuẫn tài liệu: QT **không** được phân quyền và **không** được sửa/xóa dữ liệu bản đồ.

**Giải pháp loại bỏ bypass hoàn toàn:**

Gỡ bỏ đoạn `if (req.user.role === 'system_admin') { return next(); }` trong `requirePermission`. Bắt buộc kiểm tra `req.user.role_permissions` cho **tất cả 5 role DB kể cả system_admin**; KH anonymous và GEE service account theo cơ chế riêng.

Ma trận `auth.roles.permissions` trong CSDL và `docs/MA_TRAN_PHAN_QUYEN.csv` là **nguồn sự thật duy nhất**. Với `system_admin`, seed JSONB trong DB sẽ chỉ bật quyền cho các tài nguyên quản trị hệ thống và từ chối các quyền bị loại trừ (`roles:manage`, `users:change_role`, `layers:update`, `layers:delete`, `layers:grant`, `api_registry:grant`, `map_feature:update`, `hydro:publish_scenario`, `kttv:display_config`).

Kèm test hồi quy khẳng định `system_admin` nhận 403 khi gọi các endpoint không được cấp quyền trong DB.

## D.4. Ba tầng kiểm soát truy cập

1. **RBAC** — vai trò → hành động, qua `requirePermission(resource, action)`.
2. **ABAC theo tài nguyên** — kiểm tra `gis.layer_permissions` cho từng `layer_id` trong request. Bắt buộc với mọi endpoint đọc/ghi dữ liệu không gian.
3. **Phạm vi tổ chức** — người dùng chỉ quản trị tài khoản trong `org_id` của mình (yêu cầu multi-tenant của A.1-3).

Middleware mới: `requireLayerAccess('view'|'edit'|'delete')` đọc `req.params.layerId`, truy vấn ACL, ghi kết quả vào `req.layerAcl`.

---

# Phần E. Quy trình Agile Scrum

## E.0. Ranh giới phạm vi — ĐỌC TRƯỚC

**Kế hoạch này chỉ bao gồm phân hệ máy chủ (API + CSDL + tích hợp dịch vụ ngoài).** Không bao gồm bất kỳ giao diện người dùng nào.

| Thành phần | Ai làm | Khi nào | Trạng thái |
|---|---|---|---|
| Server API (tài liệu này) | Đội trong E.1 | 23 sprint (≈ 10,5–11 tháng) | Đang lập kế hoạch |
| Ứng dụng di động `campha_moblie` (Flutter) | **Chủ dự án tự làm** | **Sau khi backend xong** | Khung Flutter đã có, chờ API |
| WebGIS SPA + 10 màn hình quản trị (Leaflet) | **CHƯA CÓ CHỦ** | Chưa xác định | ⚠ **Phụ thuộc ngoài chưa giải quyết** |

**Hệ quả bắt buộc phải chấp nhận:**

1. **Sprint Review không demo được giao diện.** Nghiệm thu ở mức API — xem E.4a. Mọi câu "demo" trong Phần F đều hiểu theo nghĩa này.
2. **API phân hệ di động (B-1…B-6) được thiết kế khi chưa có bên tiêu thụ.** Đây là rủi ro thật (R10): hợp đồng API không có client thực nghiệm thường phải sửa lại khi tích hợp. Giảm thiểu bằng cách chốt request/response trong Postman collection trước khi code và dành quỹ sửa đổi ở E.8.
3. **21 màn hình web (10 quản trị A.1-* + 11 người dùng A.2-*) hiện không có ai làm.** Tài liệu yêu cầu ghi rõ A.2-1 xây trên **Leaflet**. Khối lượng ước tính 350–450 SP — xấp xỉ **một nửa** phần server. Đây không phải hạng mục phụ; cần chốt nhà thầu/đội thực hiện trước khi server tới S4, nếu không phần A.2 sẽ hoàn thành mà không ai kiểm chứng được.

## E.1. Tổ chức nhóm

| Vai trò Scrum | Số lượng | Trách nhiệm |
|---|---|---|
| Product Owner | 1 | Đại diện chủ đầu tư (Sở TN&MT); sở hữu Product Backlog, nghiệm thu story |
| Scrum Master | 1 | Điều phối nghi thức, gỡ vật cản, bảo vệ sprint scope |
| Backend Dev | 3 | Node.js/PostGIS |
| GIS/Data Engineer | 1 | GeoServer, GEE, chuẩn hóa dữ liệu, EPSG |
| QA/Security | 1 | Test tự động, kiểm thử bảo mật |
| Chuyên gia thủy văn (part-time) | 1 | Cố vấn Sprint 11–12, nghiệm thu hiệu chỉnh mô hình |

**Không có lập trình viên front-end hay mobile trong đội này** — đúng với ranh giới phạm vi ở E.0. Đừng lập lịch dựa trên giả định ngược lại.

## E.2. Nhịp làm việc

| Nghi thức | Thời lượng | Tần suất |
|---|---|---|
| Sprint Planning | 3 giờ | Đầu mỗi sprint (thứ Hai tuần 1) |
| Daily Scrum | 15 phút | Hằng ngày 09:00 |
| Backlog Refinement | 1,5 giờ | Thứ Tư tuần 2 |
| Sprint Review (demo) | 1,5 giờ | Thứ Sáu tuần 2 |
| Sprint Retrospective | 1 giờ | Ngay sau Review |
| **Sprint** | **2 tuần** | 23 sprint kể cả đệm (≈ 10,5–11 tháng, biên độ 19–27) |

## E.3. Definition of Ready (DoR)

Story chỉ vào sprint khi:

- [ ] Có mã module tham chiếu tài liệu (ví dụ `A.1-2(4)`).
- [ ] Viết dạng: *Là <tác nhân>, tôi muốn <hành động>, để <giá trị>*.
- [ ] Có tiêu chí chấp nhận dạng Given/When/Then, tối thiểu 1 ca thành công + 1 ca lỗi + 1 ca **từ chối quyền**.
- [ ] Đã xác định vai trò nào được/không được thực hiện (đối chiếu `MA_TRAN_PHAN_QUYEN.csv`).
- [ ] Có hợp đồng API (đường dẫn, request/response, mã lỗi) trong Postman collection nháp.
- [ ] Dữ liệu đầu vào cần thiết đã sẵn có hoặc có dữ liệu mẫu thay thế.
- [ ] Ước lượng ≤ 13 SP (lớn hơn phải tách).

## E.4. Definition of Done (DoD)

Story chỉ được coi là xong khi:

- [ ] Code merge vào `develop` qua PR có ≥1 review chấp thuận.
- [ ] Unit test cho service/repository; **độ phủ nhánh ≥ 75%** phần code mới.
- [ ] Integration test qua `supertest` chạy trên PostgreSQL+PostGIS staging/test thật, tách biệt bằng database/schema test.
- [ ] **Test phân quyền tự động** cho đủ tác nhân áp dụng trên mọi endpoint mới: 5 role DB; thêm KH anonymous và GEE service account khi endpoint hỗ trợ (bắt buộc, không miễn trừ).
- [ ] Migration idempotent, chạy được cả `up` và trên DB đã có dữ liệu.
- [ ] Postman collection cập nhật; response tuân thủ `core/success.response.js` và `core/error.response.js`.
- [ ] Thông điệp i18n vi + en đầy đủ.
- [ ] Ghi `system_logs` cho mọi hành động ghi/xóa.
- [ ] CI xanh: lint, test, `npm audit --audit-level=high`, Semgrep, gitleaks.
- [ ] Không có secret/khóa API trong code hay log.
- [ ] **Nghiệm thu được ở mức API trên `staging`** theo E.4a.

## E.4a. Nghiệm thu khi không có giao diện

Vì phạm vi chỉ là server (E.0), "demo" ở Sprint Review **không phải** trình diễn màn hình. Bằng chứng nghiệm thu của mỗi story gồm 4 thứ, thiếu một thứ là story chưa xong:

| # | Bằng chứng | Hình thức |
|---|---|---|
| 1 | **Postman collection chạy được** cho mọi endpoint của story, có sẵn biến môi trường staging và tài khoản mẫu của từng vai trò | File `.postman_collection.json` trong `docs/api/`; CI chạy smoke test tương đương bằng Node 24 `fetch` để tránh thêm CLI dependency lỗi thời |
| 2 | **Báo cáo test tự động**: unit + integration + ma trận phân quyền 7 tác nhân/5 role DB | Kết xuất từ CI, đính vào story |
| 3 | **Bằng chứng dữ liệu**: truy vấn SQL hoặc ảnh chụp kết quả trong DB/MinIO/GeoServer chứng minh dữ liệu thật đã được ghi đúng | Ảnh chụp hoặc kết xuất truy vấn |

Với story không gian, bổ sung điều kiện thứ 5: **mở lớp kết quả bằng QGIS** kết nối trực tiếp vào PostGIS hoặc qua WMS của GeoServer, chụp màn hình. Đây là cách xem được bản đồ thật mà không cần chờ WebGIS SPA — và cũng là công cụ mà cán bộ GIS của Sở đã quen dùng, nên PO nghiệm thu được ngay.

Quy tắc: **PO phải tự bấm chạy được Postman collection**, không xem lập trình viên chạy hộ. Nếu PO không chạy được thì story chưa đạt.

## E.5. Quản lý backlog

Cấu trúc 4 tầng: **Epic (theo phân hệ) → Feature (theo module A.1-x/A.2-x/B-x) → Story (theo chức năng con) → Task**.

Ví dụ:

```
EPIC-2  Quản trị WebGIS
└── FEAT-A.1-2  Quản trị lớp dữ liệu bản đồ            [34 SP]
    ├── US-A.1-2.1  Thêm lớp từ shapefile               [8 SP]
    ├── US-A.1-2.2  Thêm lớp từ file Excel toạ độ       [5 SP]
    ├── US-A.1-2.3  Chỉnh sửa metadata lớp              [3 SP]
    ├── US-A.1-2.4  Xóa lớp (soft delete + gỡ GeoServer)[5 SP]
    ├── US-A.1-2.5  Phân quyền lớp theo vai trò         [8 SP]
    └── US-A.1-2.6  Tìm kiếm + phân trang + chọn số dòng[5 SP]
```

Công cụ: Jira hoặc GitHub Projects. Mỗi story gắn nhãn `module:A.1-2`, `risk:high|med|low`, `security-review:required`.

## E.6. Chiến lược nhánh Git

```
main        ← chỉ nhận release tag, luôn triển khai được lên production
develop     ← tích hợp liên tục, tự động deploy staging
feature/US-A.1-2.1-import-shapefile
hotfix/…    ← nhánh từ main, merge ngược cả main và develop
release/v1.x ← đóng băng scope, chỉ sửa lỗi
```

Quy ước commit: Conventional Commits (`feat(gis): import shapefile to PostGIS`). Mỗi PR bắt buộc gắn mã story.

---

# Phần F. Roadmap 23 sprint

21 sprint công việc + 1 sprint đệm (S12b) + 1 sprint UAT (S15) = 23 sprint × 2 tuần ≈ **10,5–11 tháng**, biên độ 19–27 sprint. Xem A.1b về độ tin cậy của con số này — **không cam kết mốc cứng với chủ đầu tư trước khi hiệu chỉnh ở US-3.8 (cuối Sprint 3)**.

Cột "Bảo mật" nêu hoạt động an ninh bắt buộc trong sprint đó. Mọi mục "Nghiệm thu" hiểu theo E.4a — nghiệm thu ở mức API, không có giao diện (xem ranh giới phạm vi E.0).

Ba sprint quá tải được tách đôi và đặt tên **6a/6b, 9a/9b, 10a/10b** thay vì đánh số lại toàn bộ — nhờ vậy mọi tham chiếu tới S11–S15 trong tài liệu này, trong backlog Jira và trong hợp đồng đều giữ nguyên hiệu lực.

Nguyên tắc áp dụng khi tách: **lát cắt dọc, không cắt ngang.** Mỗi nửa phải chạy được từ API xuống DB và demo được ở Sprint Review. Không tồn tại "sprint làm schema" rồi "sprint làm API" — cách đó làm mất khả năng nghiệm thu từng sprint, tức là bỏ Scrum mà vẫn giữ tên gọi. Nửa sau của mỗi cặp luôn chứa phần rủi ro cao hơn, để nếu vỡ thì nửa đầu đã được nghiệm thu xong.

## Sprint 0 — Nền tảng & chuẩn hóa (2 tuần)

**Mục tiêu sprint:** Dịch vụ native trên VPS chạy ổn định qua PM2/Nginx, CI xanh, và phân quyền 7 tác nhân/5 role DB đúng tài liệu.

| # | Công việc | Đầu ra |
|---|---|---|
| 0.1 | Chuẩn hóa Node.js 24 LTS + PM2; PostgreSQL/PostGIS/pgRouting, MinIO và GeoServer là dịch vụ native trên VPS (**không dùng Docker**) | Môi trường dev/staging đồng nhất bằng `.env.example` + runbook |
| 0.2 | Migration `002_campha_foundation.sql`: 5 role DB đúng tài liệu; KH anonymous, GEE service account; mô tả đúng Cẩm Phả | **Đã triển khai + migration VPS** |
| 0.3 | `auth.organizations` + `users.org_id` (khắc phục G4) | **Đã triển khai + kiểm thử** |
| 0.4 | Sửa `requirePermission`, gỡ bỏ hoàn toàn bypass `system_admin`, áp dụng RBAC đồng nhất từ DB (khắc phục G2) | **Đã triển khai + kiểm thử** |
| 0.5 | Hoàn thiện `systemLog`, endpoint quản trị và audit cleanup | **Đã triển khai; migration 003** |
| 0.6 | Khung Jest + Supertest; integration test kết nối PostgreSQL/PostGIS staging thật qua biến môi trường | Nền kiểm thử native VPS |
| 0.7 | CI GitHub Actions: lint → test → coverage → `npm audit` → Semgrep → gitleaks | Cổng chất lượng |
| 0.8 | Postman collection + environment làm hợp đồng API duy nhất; không triển khai Swagger/OpenAPI | Hợp đồng API |
| 0.9 | Chốt `MA_TRAN_PHAN_QUYEN.csv` (27 module × 7 tác nhân/5 role DB) với PO | **BLOCKER: còn dòng `ASSUMPTION`** |
| 0.10 | **Hoãn Redis theo YAGNI**; khi có job dài, dùng queue PostgreSQL `FOR UPDATE SKIP LOCKED`, chỉ thêm Redis khi có số liệu nút nghẽn | Quyết định kiến trúc đã chốt |
| 0.11 | Gán người chịu trách nhiệm + hạn chót cho toàn bộ dòng ở Phụ lục 2 | **BLOCKER: cần tên người thật** |
| 0.12 | Khung nghiệm thu API: `docs/api/`, Postman collection mẫu và Node 24 smoke runner | Nghiệm thu khi chưa có giao diện |
| 0.13 | Migration runner: PostgreSQL advisory lock, SHA256 checksum, forward-fix và smoke test | Migration vận hành an toàn |

**Bảo mật:** thiết lập baseline — bật gitleaks, quét phụ thuộc lần đầu, viết `SECURITY.md`, định nghĩa mô hình mối đe dọa sơ bộ (G.1).

**Rủi ro:** phần 0.9 phụ thuộc phản hồi chủ đầu tư về 4 điểm mâu thuẫn (mục J.1). Nếu chưa có, dùng phương án ghi trong tài liệu và đánh dấu `ASSUMPTION` trong CSV.

---

## Sprint 1 — Xác thực & quản trị người dùng (A.1-3, A.2-8, A.2-9, B-3, B-4)

| Story | Nội dung |
|---|---|
| US-1.1 | Đăng nhập/đăng xuất/refresh; thông báo đăng nhập không hợp lệ (A.2-8, B-3) |
| US-1.2 | Đăng ký tài khoản người dân + xác minh email (A.2-9, B-4) |
| US-1.3 | CRUD tài khoản theo phạm vi tổ chức (A.1-3(1)) |
| US-1.4 | Phân quyền tài khoản — **chỉ TNMT** (A.1-3(2)) |
| US-1.5 | Tìm kiếm theo email/họ tên/tên đăng nhập, phân trang (A.1-3(3),(6)) |
| US-1.6 | Khóa/mở khóa tài khoản (A.1-3(4)) |
| US-1.7 | Cấp lại mật khẩu + buộc đổi lần đăng nhập kế (A.1-3(5)) |
| US-1.8 | **Removed by product decision:** không triển khai LDAP/Active Directory trên VPS dùng chung; runtime/schema retire bằng migration 008 |
| US-1.9 | Chống dò mật khẩu: khóa lũy tiến + rate limit theo IP và theo tài khoản |
| US-1.10 | Tích hợp MFA (TOTP / Google Authenticator) cho tài khoản quản trị (`so_tnmt`, `system_admin`), bao gồm luồng thiết lập, mã khôi phục và test tự động |

**Bảo mật:** kiểm thử thủ công OWASP ASVS V2 (Authentication) và V3 (Session). Kịch bản bắt buộc: brute-force, token replay, refresh token reuse, IDOR trên `/admin/users/:id`, leo thang vai trò qua sửa payload, xác thực MFA.

---

## Sprint 2 — Hạ tầng dữ liệu không gian: MinIO + GeoServer

| Story | Nội dung |
|---|---|
| US-2.1 | Dịch vụ MinIO: upload đa phần, presigned URL, phân loại bucket (`layers`, `raster`, `documents`, `field-photos`) |
| US-2.2 | Quét mã độc file upload (ClamAV) + kiểm tra magic bytes, chặn theo phần mở rộng |
| US-2.3 | GeoServer REST client: tạo/xóa workspace, datastore PostGIS, layer, style SLD |
| US-2.4 | Đăng ký SRID VN-2000 múi 3° KT trục 107°45′ vào `spatial_ref_sys` + tiện ích chuyển đổi |
| US-2.5 | Bảng `gis.layers` + `gis.layer_permissions` + middleware `requireLayerAccess` |
| US-2.6 | Proxy WMS/WFS có kiểm tra quyền — client **không** gọi thẳng GeoServer (WFS tắt mặc định trên GeoServer, chỉ đi qua Node proxy khi được cấp phép) |
| US-2.7 | Spike phương án GeoServer đọc COG/GeoTIFF trên MinIO (S3 extension / GeoServer S3 GeoTIFF plugin vs sync volume local) |

**Bảo mật:** GeoServer không mở ra internet; chỉ Node API truy cập. Đổi mật khẩu admin mặc định, tắt trang quản trị công khai, chặn `WFS-T` và tắt WFS trực tiếp. Kiểm thử SSRF trên tham số URL của GeoServer client.

---

## Sprint 3 — Quản trị lớp dữ liệu bản đồ (A.1-2)

| Story | Nội dung |
|---|---|
| US-3.1 | Import shapefile (.shp/.dbf/.shx/.prj trong ZIP) → PostGIS, kiểm tra topology, báo lỗi từng dòng |
| US-3.2 | Import Excel có cột toạ độ → lớp điểm |
| US-3.3 | Chỉnh sửa lớp (chỉ TNMT), có optimistic lock (`src/utils/optimistic-lock.util.js`) |
| US-3.4 | Xóa lớp: soft delete + hủy publish GeoServer + dọn MinIO (job nền) |
| US-3.5 | Phân quyền lớp dữ liệu theo vai trò (chỉ TNMT) |
| US-3.6 | Tìm kiếm theo tên, phân trang, chọn số dòng/trang |
| US-3.7 | Nạp 7 lớp nền địa lý TP Cẩm Phả + ranh giới phường/xã |
| **US-3.8** | **Hiệu chỉnh ước lượng toàn dự án** (xem A.1b): tính velocity thật từ S1–S3, đội ước lượng lại backlog tồn bằng Planning Poker, thay bảng tải trọng bằng số thật, báo cáo mốc mới cho chủ đầu tư |

**Bảo mật:** import file là bề mặt tấn công lớn nhất. Bắt buộc: giới hạn dung lượng, giải nén an toàn (chống zip-slip, zip bomb), chạy import trong worker tách biệt, `SET LOCAL statement_timeout`, tên bảng sinh ra phải qua allowlist ký tự (chống SQL injection qua định danh).

---

## Sprint 4 — WebGIS front-end API (A.2-1)

| Story | Nội dung |
|---|---|
| US-4.1 | Danh mục lớp theo quyền người dùng hiện tại (bao gồm khách) |
| US-4.2 | Truy vấn thuộc tính đối tượng theo `layerId` + `featureId` |
| US-4.3 | Tìm kiếm đối tượng theo tên (full-text tiếng Việt, `unaccent` + `pg_trgm`) |
| US-4.4 | API chú giải + cấu hình hiển thị theo tỷ lệ (min/max zoom) |
| US-4.5 | Danh mục bản đồ nền (OSM, Google/Bing, nền Cục Đo đạc) |
| US-4.6 | API dữ liệu địa hình 3D: phục vụ terrain tile / DEM từ MinIO |

*(US-4.7 "Cache tầng đọc bằng Redis + ETag" đã chuyển sang S14 — xem A.1b. Cache là hạng mục hiệu năng, thuộc về sprint gia cố cùng US-14.2/14.3, và việc dời giúp S4 về mức 1,2× năng lực.)*

**Bảo mật:** kiểm soát giới hạn kích thước response, chống trích xuất hàng loạt (bbox tối đa, `LIMIT` cứng), rate limit riêng cho endpoint không gian.

---

## Sprint 5 — CMS: tin tức, văn bản, bản đồ PDF (A.1-4/6/7, A.2-5/6/7, B-5, B-6)

| Story | Nội dung |
|---|---|
| US-5.1 | CRUD tin tức + tìm kiếm + phân trang (A.1-6) |
| US-5.2 | Đọc tin tức + bình luận (bắt buộc đăng nhập) + kiểm duyệt (A.2-5) |
| US-5.3 | Kho văn bản/báo cáo: upload PDF/DOC/XML lên MinIO, gắn mã số, cơ quan ban hành (A.1-4) |
| US-5.4 | Tra cứu văn bản: **công khai cho KH**, văn bản nội bộ chỉ UB/TNMT/XD/QT (A.2-7, B-6) |
| US-5.5 | Bản đồ PDF + siêu dữ liệu (tỷ lệ, năm, cơ quan lập); xem/tải theo quyền (A.1-7, A.2-6) |
| US-5.6 | Đồng bộ nội dung cho mobile qua cùng REST API (B-5, B-6) |

**Bảo mật:** phân biệt rõ tài nguyên công khai / nội bộ ngay ở tầng repository (cột `visibility`), không dựa vào việc client không hiển thị. Bình luận phải khử HTML (chống stored XSS). Tải file luôn qua presigned URL ngắn hạn, không lộ đường dẫn MinIO trực tiếp.

---

## Sprint 6a — Kho ảnh vệ tinh & tra cứu (A.1-1, A.2-2 phần xem) — 42 SP

**Mục tiêu sprint:** người dùng duyệt, tìm kiếm và so sánh được ảnh vệ tinh; chưa cần GEE tính toán.

| Story | Nội dung |
|---|---|
| US-6a.1 | Kho ảnh: metadata Sentinel-1/2, Landsat 7/8; thêm/xóa ảnh (A.1-1(1)) |
| US-6a.2 | Phân loại ảnh theo nhóm chuyên đề (A.1-1(6)) |
| US-6a.3 | Tìm kiếm theo thời gian thu nhận và theo loại (A.1-1(2), A.2-2(2),(3)) |
| US-6a.4 | Phân trang, chọn số dòng, sắp xếp theo thời gian thu nhận (A.1-1(3),(4),(5)) |
| US-6a.5 | Hiển thị so sánh 2 thời điểm cùng khu vực (A.2-2(1)) |
| US-6a.6 | Tải ảnh vệ tinh theo khoảng thời gian và theo loại (A.2-2(4),(5)) |

**Nghiệm thu (E.4a):** Postman — nạp metadata 3 cảnh ảnh, lọc theo khoảng thời gian, phân trang, lấy cặp URL so sánh 2 thời điểm, tải file về qua presigned URL. Bằng chứng dữ liệu: liệt kê object trong bucket `raster` của MinIO.

**Bảo mật:** ảnh vệ tinh dung lượng lớn → giới hạn tần suất tải theo người dùng, dùng presigned URL ngắn hạn, không lộ đường dẫn MinIO.

---

## Sprint 6b — Phân loại ảnh trên Google Earth Engine (A.2-2 phần tính toán) — 43 SP

**Mục tiêu sprint:** chạy được một lượt phân loại đầy đủ và ghi kết quả thành lớp GIS mới.

| Story | Nội dung |
|---|---|
| US-6b.1 | Xác thực GEE bằng service account; hàng đợi job GEE có tiến độ, timeout, hủy |
| US-6b.2 | Quản lý mẫu huấn luyện (training samples) theo lớp: mặt nước, dân cư, rừng, đất trống, nông nghiệp |
| US-6b.3 | Phân loại tự động Random Forest / SVM / CART (A.2-2(6)) |
| US-6b.4 | Tính diện tích đối tượng sau phân loại (A.2-2(7)) |
| US-6b.5 | Xuất kết quả sang vector, ghi vào PostGIS thành lớp mới + publish GeoServer (A.2-2(8)) |
| US-6b.6 | Tải lớp dữ liệu sau phân loại (A.2-2(9)) |

**Nghiệm thu (E.4a):** Postman — gửi job phân loại (cảnh ảnh + bộ mẫu), truy vấn tiến độ tới khi hoàn tất, đọc bảng diện tích từng loại. Bằng chứng không gian: **mở lớp kết quả bằng QGIS qua WMS GeoServer**, chụp màn hình bản đồ phân loại.

**Bảo mật:** khóa service account GEE lưu mã hóa, không đặt plaintext trong biến môi trường trên máy chủ dùng chung; hạn mức theo người dùng để tránh cạn quota GEE (dạng DoS kinh tế).

**Rủi ro cao (lý do đặt ở nửa sau):** thời gian chạy GEE không dự đoán được và phụ thuộc dịch vụ ngoài. Nếu sprint này trượt, S6a đã nghiệm thu xong và người dùng vẫn có kho ảnh dùng được.

---

## Sprint 7 — Phân tích không gian & thống kê (A.2-3, A.2-4)

| Story | Nội dung |
|---|---|
| US-7.1 | Tính diện tích ngập tự động từ lớp kết quả phân loại (A.2-4(1)) |
| US-7.2 | Tính diện tích khu dân cư (A.2-4(2)) |
| US-7.3 | So sánh diện tích và vị trí ngập giữa 2 thời điểm (A.2-4(3)) |
| US-7.4 | Biểu đồ ngập theo năm; theo phường/xã (A.2-3(2),(3)) |
| US-7.5 | Biểu đồ hạ tầng xây dựng mới theo đơn vị hành chính và theo năm (A.2-3(4),(5)) |
| US-7.6 | Xuất báo cáo PDF/DOCX/XML/ODT (A.2-3(1)) |
| US-7.7 | Materialized view + lịch refresh cho số liệu thống kê |

**Bảo mật:** sinh báo cáo là điểm dễ bị **injection vào template** và **DoS bằng truy vấn nặng**. Bắt buộc: template không cho phép biểu thức tùy ý, giới hạn khoảng thời gian truy vấn, đưa việc sinh báo cáo lớn vào job nền.

---

## Sprint 8 — Phản ánh cộng đồng & realtime (A.1-8, A.2-11, B-2)

| Story | Nội dung |
|---|---|
| US-8.1 | Gửi phản ánh kèm ảnh + toạ độ + mô tả (A.2-11) |
| US-8.2 | Chụp ảnh hiện trạng lấn chiếm từ mobile, đo đạc tương đối (B-2) |
| US-8.3 | Socket.io + cầu nối PostgreSQL `LISTEN/NOTIFY` → thông báo tức thời cho quản trị (A.1-8(1)) |
| US-8.4 | Xem thông tin thay đổi tại vị trí được cập nhật (A.1-8(2)) |
| US-8.5 | Thống kê số người phản ánh cùng một địa điểm (gom cụm theo bán kính, `ST_ClusterDBSCAN`) — xác thực thông tin (A.1-8(3)) |
| US-8.6 | Quy trình duyệt/bác bỏ phản ánh (TNMT, UB, XD — **không** QT) |
| US-8.7 | Thông báo đẩy FCM tới người gửi khi trạng thái thay đổi |
| **SPIKE-8.8** | **Nghiên cứu khả thi engine mô hình thủy lực — timebox 5 ngày, 1 người** |

### SPIKE-8.8 — chi tiết

**Vấn đề:** ADR-08 giả định engine thủy lực là phần mềm chuyên dụng bên ngoài, nhưng **chưa chọn phần mềm nào** (xem J.1-5), trong khi S11–S12 nằm trên đường găng. Nếu đến S12 mới phát hiện engine không điều khiển được tự động từ Node thì không còn sprint nào để xoay.

**Vì sao đặt trong S8:** S8 không nằm trên đường găng, nên rút 1 người trong 5 ngày không làm chậm tiến độ chung. Rẻ hơn nhiều so với dành hẳn một sprint.

**Đầu ra bắt buộc:**
- Dựng một mô hình đồ chơi (1 tiểu lưu vực, 1 đoạn kênh) trên engine được đề xuất.
- Chạy engine ở chế độ headless từ tiến trình Node, không thao tác giao diện.
- Đọc được kết quả và nhật ký hội tụ về dạng máy đọc được.
- Báo cáo: định dạng file tham số, cách truyền tham số, thời gian chạy, giấy phép, yêu cầu hạ tầng tính toán.

**Điều kiện vào S11:** spike phải kết luận thành công. Nếu thất bại với engine đầu tiên, thử engine thứ hai trong S9a (thêm 5 ngày) — vẫn còn 2 sprint đệm trước S11.

**Bảo mật:** dữ liệu người dân là **dữ liệu cá nhân** — chịu điều chỉnh của **Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15** (hiệu lực 01/01/2026) và **Nghị định 356/2025/NĐ-CP**. Bắt buộc: gỡ EXIF GPS khỏi ảnh trước khi công bố công khai, ẩn danh người gửi ở API công khai, ghi nhật ký truy cập dữ liệu cá nhân, và cơ chế xóa theo yêu cầu chủ thể dữ liệu. Xác thực Socket.io bằng JWT ở handshake, phân phòng theo vai trò.

---

## Sprint 9a — Mobile GIS: xem, định vị, đo đạc, vẽ (B-1 phần chỉ đọc + vẽ) — 37 SP

**Mục tiêu sprint:** ứng dụng di động hiển thị bản đồ, định vị, đo đạc và vẽ được — chưa sửa dữ liệu gốc, chưa tìm đường.

| Story | Nội dung |
|---|---|
| US-9a.1 | API lớp bản đồ tối ưu cho di động (vector tile MVT, `ST_AsMVT`) (B-1(1),(2)) |
| US-9a.2 | Xem thông tin thuộc tính đối tượng trên mobile, lọc theo layer ACL (B-1(3)) |
| US-9a.3 | Hỗ trợ định vị GPS: API đối tượng lân cận theo toạ độ hiện tại (B-1(4)) |
| US-9a.4 | API đo đạc chiều dài/diện tích chính xác theo VN-2000 múi 3° (B-1(6)) |
| US-9a.5 | Nhận đối tượng vẽ từ mobile: điểm/đường/vùng, lưu vào lớp phác thảo riêng (B-1(7)) |
| US-9a.6 | API thời tiết: hướng gió, tốc độ, nhiệt độ (B-1(9)) |

**Nghiệm thu (E.4a):** Postman — lấy vector tile MVT theo z/x/y, truy vấn thuộc tính đối tượng, gọi API đối tượng lân cận với một toạ độ trong TP, gửi hình học vẽ tay và đọc lại, lấy dữ liệu thời tiết. Bằng chứng không gian: mở endpoint MVT bằng QGIS, chụp màn hình.

> **Lưu ý phạm vi:** phía client Flutter do chủ dự án tự làm sau khi backend xong (E.0). Sprint này giao **hợp đồng API đã chốt**, không giao màn hình.

**Bảo mật:** đối tượng vẽ từ mobile ghi vào **lớp phác thảo tách biệt**, không chạm dữ liệu gốc — ranh giới này là điều kiện để S9b an toàn.

**Lưu ý:** US-9a.6 phụ thuộc S10 (nguồn KTTV). Nếu S10 chưa xong, tạm dùng `openweather.client.js` đã có trong repo và thay nguồn ở S10b.

---

## Sprint 9b — Mobile GIS: tìm đường, sửa dữ liệu, đồng bộ ngoại tuyến — 36 SP

**Mục tiêu sprint:** hoàn thiện hai năng lực rủi ro cao nhất của phân hệ di động.

| Story | Nội dung |
|---|---|
| US-9b.1 | Làm sạch topology mạng đường; kiểm tra thông tuyến bằng `pgr_analyzeGraph` |
| US-9b.2 | Cài pgRouting + API tìm đường đi ngắn nhất giữa 2 điểm (B-1(5)) |
| US-9b.3 | Cập nhật thuộc tính đối tượng — **chỉ TNMT** (B-1(8)) |
| US-9b.4 | Cập nhật hình học đối tượng + lưu lịch sử phiên bản để khôi phục (B-1(8)) |
| US-9b.5 | Đồng bộ ngoại tuyến: hàng đợi thay đổi, giải quyết xung đột theo `updated_at` + `version` |

**Nghiệm thu (E.4a):** Postman — gọi API tìm đường giữa 2 toạ độ, nhận về hình học tuyến; tài khoản TNMT sửa hình học một đối tượng và đọc lại lịch sử phiên bản; mô phỏng đồng bộ ngoại tuyến bằng cách gửi lô thay đổi có `version` cũ và kiểm tra cơ chế giải quyết xung đột trả về đúng. Bằng chứng: kết xuất `pgr_analyzeGraph` chứng minh mạng đường thông tuyến.

**Bảo mật:** B-1(8) là **endpoint nguy hiểm nhất hệ thống** — sửa dữ liệu bản đồ gốc từ thiết bị di động. Bắt buộc: chỉ vai trò TNMT, kiểm tra ACL theo từng lớp, ghi nhật ký giá trị trước/sau, lưu toàn bộ lịch sử phiên bản hình học, và có đường khôi phục đã được kiểm thử.

**Rủi ro cao (lý do đặt ở nửa sau):** hai rủi ro độc lập cùng nằm ở đây — chất lượng topology dữ liệu giao thông thật (R6) và độ phức tạp của đồng bộ ngoại tuyến. Nếu trượt, S9a đã nghiệm thu và app vẫn dùng được ở mức tra cứu.

---

## Sprint 10a — Khai báo nguồn KTTV & danh mục trạm (Công việc 7.7, phần cấu hình) — 40 SP

**Mục tiêu sprint:** khai báo và kết nối thành công tới ít nhất một nguồn KTTV thật, xem trước được dữ liệu trả về.

| Story | Nội dung |
|---|---|
| US-10a.1 | CRUD nguồn dữ liệu: endpoint, loại dịch vụ, hạn mức, định dạng, điều kiện bản quyền (A.1-10(1)) |
| US-10a.2 | Lưu khóa truy cập dạng mã hóa + phương thức xác thực; không bao giờ trả về nguyên văn |
| US-10a.3 | Kiểm tra kết nối + xem trước dữ liệu trả về (A.1-10(2)) |
| US-10a.4 | **Lớp chặn SSRF**: allowlist tên miền, chặn IP nội bộ, không theo redirect, timeout, giới hạn dung lượng |
| US-10a.5 | Cấu hình không gian: bbox, lớp cắt, EPSG nguồn/đích, phương pháp nội suy, độ phân giải đích (A.1-10(3)) |
| US-10a.6 | Cấu hình thời gian: chu kỳ, múi giờ UTC→UTC+7, độ trễ cho phép, hạn dự báo, hạn lưu trữ (A.1-10(4)) |
| US-10a.7 | Danh mục biến + đơn vị gốc + hệ số quy đổi + NoData + khoảng giá trị hợp lệ (A.1-10(5)) |
| US-10a.8 | Danh mục trạm quan trắc + trọng số nội suy Thiessen/IDW (A.1-10(7)) |

**Nghiệm thu (E.4a):** Postman — khai báo một nguồn thật (Open-Meteo hoặc GSMaP), gọi endpoint kiểm tra kết nối, nhận về bản xem trước đã cắt đúng phạm vi Cẩm Phả. Bắt buộc kèm **bằng chứng chặn SSRF**: thử khai báo endpoint trỏ tới `169.254.169.254` và `127.0.0.1`, cả hai phải bị từ chối.

**Bảo mật — trọng tâm của sprint này:** đây là nơi hệ thống **gọi ra ngoài theo URL do người dùng nhập** → nguy cơ SSRF cao nhất toàn dự án. US-10a.4 là điều kiện tiên quyết, phải xong trước US-10a.3. Bắt buộc: allowlist tên miền, chặn dải IP nội bộ (169.254.0.0/16, 10/8, 172.16/12, 192.168/16, ::1), không đi theo redirect tới host ngoài allowlist, timeout cứng, giới hạn dung lượng tải. Khóa API lưu bằng `pgcrypto`/KMS, chỉ hiển thị 4 ký tự cuối kể cả với TNMT.

---

## Sprint 10b — Thu thập tự động, kiểm soát chất lượng & cảnh báo — 40 SP

**Mục tiêu sprint:** dữ liệu KTTV tự chảy về theo lịch, qua kiểm soát chất lượng, và lên bản đồ động.

| Story | Nội dung |
|---|---|
| US-10b.1 | Worker thu thập: tải → cắt theo ranh giới → nội suy về lưới → quy đổi đơn vị → ghi `kttv.observations` |
| US-10b.2 | Quy tắc kiểm soát chất lượng: loại giá trị ngoài khoảng, phát hiện biến thiên đột ngột, đánh dấu trạm mất tín hiệu (A.1-10(8)) |
| US-10b.3 | Lập lịch thu thập (cron), số lần thử lại, khoảng chờ, nguồn dự phòng theo thứ tự ưu tiên (A.1-10(9)) |
| US-10b.4 | Nhật ký thu thập, trạng thái kết nối, dung lượng đã tải; đánh dấu lớp quá hạn khi vượt độ trễ cho phép |
| US-10b.5 | Cấu hình hiển thị lớp: thang màu, ngưỡng phân cấp, độ trong suốt, z-index, tỷ lệ hiển thị — **chỉ TNMT** (A.1-10(6)) |
| US-10b.6 | Publish lớp dữ liệu động lên WebGIS/Mobile theo cấu hình hiển thị |
| US-10b.7 | Ngưỡng cảnh báo mưa + cấp báo động mực nước I/II/III theo trạm — **TNMT, UB** (A.1-10(8)) |
| US-10b.8 | Kênh và tần suất gửi cảnh báo: web, ứng dụng di động, thư điện tử |

**Nghiệm thu (E.4a):** để hệ thống chạy qua một chu kỳ thu thập thật, truy vấn `kttv.observations` chứng minh dữ liệu đã về và đã quy đổi đơn vị đúng; **mở lớp mưa/mực nước bằng QGIS qua WMS** để thấy thang màu đã cấu hình. Chặn một nguồn ở tầng mạng để chứng minh nguồn dự phòng và cảnh báo mất tín hiệu hoạt động.

**Bảo mật:** dữ liệu từ bên thứ ba phải được kiểm tra kiểu và miền giá trị **trước khi** ghi vào DB (OWASP API10). Cảnh báo thiên tai gửi ra ngoài phải ghi nhật ký đầy đủ ai/khi nào/ngưỡng nào kích hoạt.

**Rủi ro cao (lý do đặt ở nửa sau):** phụ thuộc R4 (dịch vụ KTTV có cho truy cập lập trình hay không). Nếu bế tắc, S10a đã nghiệm thu phần cấu hình và có thể chuyển sang nguồn mở (GSMaP, GPM IMERG, ERA5, Open-Meteo) mà không mất công đã làm.

---

## Sprint 11 — Tham số mô hình thủy văn–thủy lực — Công việc 7.6, phần 1 (A.1-9)

> **Điều kiện vào sprint:** SPIKE-8.8 đã kết luận thành công (engine mô hình điều khiển được headless từ Node). Không đạt thì không bắt đầu S11 — xem J.1-5.

| Story | Nội dung |
|---|---|
| US-11.1 | Khai báo phạm vi mô phỏng, lưới tính, bước thời gian; kiểm tra điều kiện ổn định Courant |
| US-11.2 | Nhập tham số thủy văn theo tiểu lưu vực: SCS-CN / Horton / Green-Ampt (3 JSON Schema riêng) |
| US-11.3 | Tính tự động diện tích, độ dốc trung bình, chiều dài dòng chảy chính từ DEM và ranh giới (PostGIS raster + `ST_Slope`) |
| US-11.4 | Nhập tham số thủy lực: Manning n, mặt cắt ngang, cống/cửa xả, trạm bơm, hồ điều hòa |
| US-11.5 | Điều kiện biên trên/dưới; liên kết nguồn triều tại cửa xả ra vịnh Bái Tử Long |
| US-11.6 | Quản lý phiên bản bộ tham số: lưu, sao chép, so sánh (diff), khôi phục |
| US-11.7 | Nhập/xuất bộ tham số JSON/XML/CSV |
| US-11.8 | Thiết lập ngưỡng cảnh báo ngập: độ sâu, thời gian duy trì, diện tích theo phường/xã |
| US-11.9 | Tạo và quản lý kịch bản; **chỉ TNMT** được ban hành kịch bản chính thức |

**Bảo mật:** import bộ tham số XML → bắt buộc tắt xử lý thực thể ngoài (chống XXE). Kiểm tra miền giá trị vật lý mọi tham số (ví dụ Manning n ∈ [0.008, 0.25], CN ∈ [30, 98]) để tránh mô hình hội tụ về giá trị phi vật lý — yêu cầu này tài liệu nêu rõ.

---

## Sprint 12 — Chạy mô hình, hiệu chỉnh–kiểm định & dự báo ngập (A.1-9 tiếp, A.2-10)

| Story | Nội dung |
|---|---|
| US-12.1 | Worker điều phối chạy engine mô phỏng; theo dõi tiến độ, hủy, timeout |
| US-12.2 | Nhật ký lỗi và cảnh báo hội tụ hiển thị được trên giao diện |
| US-12.3 | Hiệu chỉnh/kiểm định theo trận lũ thực đo; tính NSE, R², PBIAS, RMSE |
| US-12.4 | Ngưỡng chấp nhận theo Moriasi 2007 (NSE > 0,50 chấp nhận; > 0,75 tốt) |
| US-12.5 | Khoảng biến thiên cho phép khi tự động hiệu chỉnh |
| US-12.6 | Sinh bản đồ ngập theo thời gian, ghi thành lớp GIS (A.2-10(1)) |
| US-12.7 | Xác định khu vực ngập mới bằng so sánh đa thời gian (A.2-10(2)) |
| US-12.8 | Khoanh vùng khu dân cư mới xây trên đất ao/hồ/kênh thoát nước (A.2-10(3)) |
| US-12.9 | Sinh cảnh báo tự động khi vượt ngưỡng → thông báo web/mobile/email |

**Bảo mật:** kết quả mô hình là căn cứ cảnh báo thiên tai → tính toàn vẹn là yêu cầu an ninh, không chỉ chất lượng. Bắt buộc: kết quả gắn checksum, không sửa được sau khi ban hành (append-only), mọi lần ban hành ghi nhật ký người ban hành + phiên bản tham số.

---

## Sprint 12b — Sprint đệm (không lên lịch story trước)

**Mục đích:** hấp thụ độ lệch thay vì để nó dồn sang cuối dự án. Không được phép "mượn trước" sprint này khi lập kế hoạch S4–S12 — mượn trước là mất tác dụng.

**Thứ tự ưu tiên khi vào sprint:**

1. Carry-over tồn từ S4, S5, S8 (ba sprint liên tiếp ở mức 1,2–1,3× năng lực).
2. Nợ kỹ thuật ghi nhận trong các Retrospective trước.
3. Rủi ro nhánh thủy lực: nếu S12 chưa đạt ngưỡng kiểm định NSE > 0,50, dùng sprint này để hiệu chỉnh thêm.
4. Sửa hợp đồng API sau khi có phản hồi tích hợp đầu tiên (R10).
5. **Nếu không dùng đến:** kéo US-14.1 (siêu dữ liệu TT22/TT24) và US-14.3 (tối ưu truy vấn) từ S14 lên, để S14 tập trung cho kiểm thử xâm nhập.

---

## Sprint 13 — Registry API lớp dữ liệu (A.1-5)

| Story | Nội dung |
|---|---|
| US-13.1 | Sinh RESTful API (GET/POST/PUT/DELETE) cho một lớp bản đồ |
| US-13.2 | Cấp khóa chia sẻ (JWT có scope + hạn dùng + hạn mức) |
| US-13.3 | Phân quyền API — **chỉ TNMT** |
| US-13.4 | Tìm kiếm, phân trang, chọn số dòng, sắp xếp theo ngày đăng |
| US-13.5 | Nhật ký gọi API + bảng điều khiển hạn mức |
| US-13.6 | Thu hồi khóa tức thời |

**Bảo mật:** đây là bề mặt tấn công hướng ra ngoài tổ chức. Yêu cầu: khóa gắn scope tối thiểu (chỉ lớp cụ thể, chỉ phương thức cụ thể), mặc định chỉ đọc — mọi khóa cho phép ghi cần TNMT phê duyệt riêng; hạn mức theo khóa; ghi nhật ký đầy đủ; hỗ trợ xoay vòng khóa.

---

## Sprint 14 — Siêu dữ liệu, hiệu năng & gia cố (Hardening)

| Story | Nội dung |
|---|---|
| US-14.1 | Siêu dữ liệu lớp bản đồ theo chuẩn TCVN 12687:2019, ISO 19115 / ISO 19139 và QCVN hiện hành; xuất XML |
| US-14.2 | Kiểm thử tải k6: 500 người dùng đồng thời, mục tiêu p95 < 800 ms cho API đọc |
| US-14.3 | Tối ưu truy vấn không gian theo kết quả `EXPLAIN ANALYZE` |
| US-14.3b | Cache tầng đọc bằng Redis + ETag (chuyển từ S4) |
| US-14.4 | Gia cố: security header, CSP, giới hạn kích thước body, timeout toàn cục |
| US-14.5 | Sao lưu/khôi phục: `pg_dump` + WAL archiving + sao lưu MinIO; **diễn tập khôi phục thực tế** |
| US-14.6 | Giám sát: Prometheus + Grafana, cảnh báo khi job thất bại/độ trễ dữ liệu KTTV |
| US-14.7 | Tài liệu vận hành + tài liệu API bản chính thức |

**Bảo mật:** **kiểm thử xâm nhập độc lập** theo OWASP ASVS Level 2 và OWASP API Security Top 10 (2023). Kết quả phải xử lý xong toàn bộ lỗi mức High/Critical trước khi nghiệm thu.

---

## Sprint 15 — UAT & bàn giao (kèm cơ chế nghiệm thu tăng dần từ S5)

Hệ thống phục vụ 7 tác nhân (5 role DB, KH anonymous, GEE service account) thuộc 3 cơ quan và nhóm vận hành. Dồn toàn bộ nghiệm thu vào 2 tuần cuối nghĩa là nếu đến lúc đó UBND mới nói "chỗ này không dùng được" thì **không còn sprint nào để sửa**. Tách làm hai lớp:

### Lớp 1 — Nghiệm thu tăng dần, bắt đầu từ S5

Từ Sprint 5 trở đi, **mỗi Sprint Review có ít nhất một người dùng thật** của vai trò liên quan tham dự, không chỉ PO:

| Từ sprint | Vai trò mời tham dự | Nội dung nghiệm thu |
|---|---|---|
| S5 | Cán bộ văn thư UBND + Sở TN&MT | Kho văn bản, tin tức, phân biệt công khai/nội bộ |
| S6a, S6b | Cán bộ GIS Sở TN&MT | Kho ảnh, kết quả phân loại (xem qua QGIS) |
| S7 | Lãnh đạo UBND TP | Biểu đồ, báo cáo thống kê xuất ra |
| S8 | Cán bộ tiếp nhận phản ánh + 2–3 người dân | Luồng gửi và duyệt phản ánh |
| S9a, S9b | Cán bộ đi thực địa | Hợp đồng API cho app di động (bên tự làm — E.0) |
| S10a, S10b | Cán bộ dự báo KTTV | Nguồn dữ liệu, ngưỡng cảnh báo |
| S11, S12 | Chuyên gia thủy văn + Sở TN&MT | Bộ tham số, chỉ tiêu kiểm định |

Yêu cầu bắt buộc: phản hồi thu được phải vào backlog **ngay trong sprint đó**, không gom lại để cuối dự án xử lý.

### Lớp 2 — Sprint 15: UAT tổng thể & bàn giao

- Nghiệm thu chéo toàn bộ theo `MA_TRAN_PHAN_QUYEN.csv` với đại diện 5 role DB; bổ sung KH anonymous và GEE service account ở các luồng áp dụng — tập trung vào **luồng liên module**, vì luồng đơn lẻ đã nghiệm thu ở lớp 1.
- Chuyển dữ liệu thật (7 lớp nền, hiện trạng sử dụng đất 2015/2020/2025, dân cư, DEM ≤ 5 m).
- Đào tạo quản trị viên và cán bộ chuyên môn.
- Bàn giao mã nguồn, tài liệu, hồ sơ kiểm thử bảo mật.

**Lưu ý:** với ranh giới phạm vi ở E.0, nghiệm thu ở đây là **nghiệm thu API**, không phải nghiệm thu trải nghiệm người dùng cuối. Nghiệm thu trải nghiệm chỉ thực hiện được sau khi có web client và app di động — cần ghi rõ điều này trong biên bản để tránh tranh chấp lúc thanh quyết toán.

---

## F.x. Sơ đồ phụ thuộc giữa các sprint

```
S0 ─► S1 ─► S2 ─► S3 ─┬─► S4 ──────────────────► S7
                      │
                      ├─► S5   (độc lập)
                      │
                      ├─► S6a ─► S6b ──────────► S7 ─┐
                      │                              │
                      ├─► S8 ─► S9a ─► S9b           ├─► S12 ─► S13 ─► S14 ─► S15
                      │    │                         │
                      │    └── SPIKE-8.8 ─► [cổng]   │
                      │         (5 ngày)      │      │
                      │                       ▼      │
                      ├─► S10a ─► S10b ──────────────┤
                      │                              │
                      └───────────────────► S11 ─────┘
```

**Đường găng (2 nhánh đồng thời):**

- `S0 → S2 → S3 → S11 → S12 → S12b → S14` — nhánh mô hình thủy văn–thủy lực.
- `S0 → S2 → S3 → S10a → S10b → S12 → S12b → S14` — nhánh KTTV, sau khi tách đã dài bằng nhánh trên và trở thành **đồng găng**.

Hệ quả của việc tách: S10 nay chiếm 2 sprint trên đường găng thay vì 1. Đây là chi phí thật của việc lập kế hoạch trung thực — trước khi tách, phần công việc này vẫn tồn tại nhưng bị giấu trong một ô lịch quá tải 1,8×.

Chậm ở S3 (import dữ liệu không gian), S10b (thu thập KTTV) hoặc S11 (tham số mô hình) đều đẩy toàn bộ tiến độ. S6a/S6b và S9a/S9b **không** nằm trên đường găng — nếu buộc phải hy sinh, hy sinh ở đây trước.

---

# Phần G. Bảo mật

## G.1. Mô hình mối đe dọa (STRIDE rút gọn)

| Tài sản | Mối đe dọa chính | Biện pháp |
|---|---|---|
| Tài khoản cơ quan nhà nước | Chiếm quyền, dò mật khẩu | MFA cho TNMT/QT khi được bật, khóa lũy tiến, mật khẩu mạnh, JWT rotation/replay detection |
| Dữ liệu bản đồ gốc | Sửa/xóa trái phép (đặc biệt qua mobile B-1(8)) | ACL theo lớp, lịch sử phiên bản hình học, nhật ký đầy đủ |
| Bộ tham số & kết quả mô hình | Giả mạo kết quả cảnh báo thiên tai | Append-only sau ban hành, checksum, tách quyền lập/ban hành |
| Khóa API dịch vụ ngoài (GEE, KTTV) | Rò rỉ, lạm dụng hạn mức | Mã hóa lưu trữ, không hiển thị nguyên văn, hạn mức, xoay vòng |
| Dữ liệu cá nhân người phản ánh | Lộ toạ độ/danh tính | Ẩn danh API công khai, gỡ EXIF, Luật 91/2025/QH15 & NĐ 356/2025/NĐ-CP |
| Máy chủ ứng dụng | SSRF qua cấu hình nguồn KTTV; RCE qua file upload | Allowlist tên miền, chặn IP nội bộ, quét mã độc, worker cách ly |
| CSDL | SQL injection qua tên bảng/cột động khi import | Allowlist ký tự định danh, `pg-format` cho định danh, tham số hóa cho giá trị |
| Cơ sở hạ tầng | GeoServer/MinIO lộ ra internet | Chỉ Node API truy cập; firewall; đổi mật khẩu mặc định |

## G.2. Biện pháp kiểm soát theo tầng

**Tầng mạng/hạ tầng**
- TLS 1.2+ bắt buộc, chứng thư số hợp lệ, HSTS.
- Chỉ mở cổng 443 ra ngoài. PostgreSQL/MinIO/GeoServer/Redis nằm trong mạng nội bộ.
- Tài khoản DB riêng cho ứng dụng (không dùng `postgres`), quyền tối thiểu theo schema.

**Tầng ứng dụng**
- `helmet` với CSP chặt; `cors` theo allowlist tường minh (hiện `.env.example` để `CORS_ORIGINS=*` — **phải sửa trước khi lên production**).
- Rate limit phân tầng: toàn cục, theo endpoint auth, theo endpoint tính toán nặng, theo khóa API.
- Xác thực đầu vào bằng Joi cho **mọi** endpoint; từ chối trường không khai báo (`stripUnknown: false` + `unknown: false`).
- Response lỗi không lộ chi tiết nội bộ ở production (`error-handler.js` phải ẩn stack).
- Kích thước body tối đa; timeout request; `statement_timeout` cho DB.

**Tầng dữ liệu**
- Mật khẩu: bcrypt cost ≥ 12 (hiện dùng `bcrypt` — giữ).
- Token lưu dạng hash SHA-256 (đã áp dụng cho refresh/reset/verification — giữ nguyên nguyên tắc này cho khóa API).
- Mã hóa cột nhạy cảm (`kttv.sources.credential_enc`) bằng `pgcrypto`, khóa quản lý ngoài DB.
- Sao lưu mã hóa, kiểm thử khôi phục định kỳ.

**Tầng nhật ký & giám sát**
- Ghi `system_logs` cho mọi hành động ghi/xóa: ai, khi nào, IP, tài nguyên, giá trị trước/sau.
- **Không** ghi mật khẩu, token, khóa API vào log (kiểm tra tự động trong CI).
- Cảnh báo khi: nhiều lần đăng nhập thất bại, gọi API vượt hạn mức, job thất bại liên tiếp, dữ liệu KTTV quá hạn.

## G.3. Ánh xạ OWASP API Security Top 10 (2023)

| Mã | Rủi ro | Xử lý trong dự án |
|---|---|---|
| API1 | Broken Object Level Authorization | `requireLayerAccess`; test IDOR tự động cho mọi endpoint có `:id` |
| API2 | Broken Authentication | Sprint 1: khóa lũy tiến, refresh reuse detection (đã có `token_reuse_detected`), MFA cho vai trò cao |
| API3 | Broken Object Property Level Authorization | Joi allowlist trường; DTO tách riêng cho response, không trả nguyên bản ghi DB |
| API4 | Unrestricted Resource Consumption | Giới hạn bbox/LIMIT, job nền cho tác vụ nặng, hạn mức GEE/KTTV |
| API5 | Broken Function Level Authorization | `MA_TRAN_PHAN_QUYEN.csv` + test sinh tự động 7 tác nhân/5 role DB × mọi endpoint áp dụng |
| API6 | Unrestricted Access to Sensitive Business Flows | Hạn chế tần suất gửi phản ánh, chống spam bình luận |
| API7 | SSRF | Sprint 10a (US-10a.4): allowlist tên miền, chặn IP nội bộ, không theo redirect |
| API8 | Security Misconfiguration | Kiểm tra cấu hình trong CI; GeoServer/MinIO hardening checklist |
| API9 | Improper Inventory Management | Postman collection là bắt buộc trong DoD; registry API có vòng đời rõ ràng; Supertest đối chiếu route/role |
| API10 | Unsafe Consumption of APIs | Kiểm tra kiểu/miền giá trị dữ liệu KTTV trả về trước khi ghi DB |

## G.4. Lịch hoạt động bảo mật

| Hoạt động | Tần suất | Người thực hiện |
|---|---|---|
| SAST (Semgrep) + lint bảo mật | Mỗi PR | CI |
| Quét phụ thuộc (`npm audit`, OSV) | Mỗi PR + hằng tuần | CI |
| Quét secret (gitleaks) | Mỗi commit | CI (pre-commit + CI) |
| Test phân quyền tự động | Mỗi PR | CI |
| DAST (OWASP ZAP baseline) trên staging | Cuối mỗi sprint | QA/Security |
| Rà soát bảo mật thủ công theo ASVS | Sprint 1, 3, 8, 9b, 10a, 13 (sprint có bề mặt tấn công mới) | QA/Security |
| Kiểm thử xâm nhập độc lập | Sprint 14 | Bên thứ ba |
| Diễn tập khôi phục dữ liệu | Sprint 14, sau đó 6 tháng/lần | DevOps |

---

# Phần H. Chiến lược kiểm thử

## H.1. Kim tự tháp kiểm thử

| Tầng | Công cụ | Tỷ trọng | Chạy khi |
|---|---|---|---|
| Unit (service, util, validator) | Jest | ~60% | Mỗi commit |
| Integration (route → DB thật) | Supertest + PostgreSQL/PostGIS staging/test tách biệt | ~30% | Mỗi PR/staging gate |
| Contract (Postman) | Collection JSON parse + Node smoke/Supertest | ~5% | Mỗi PR |
| E2E nghiệp vụ | Kịch bản đa vai trò qua API | ~4% | Hằng đêm |
| Tải & chịu đựng | k6 | ~1% | Cuối sprint chẵn |

## H.2. Dữ liệu kiểm thử

- Bộ fixture GIS nhỏ: 1 phường Cẩm Phả, ~200 đối tượng, đủ đại diện điểm/đường/vùng.
- Ảnh vệ tinh: 1 cảnh Sentinel-2 cắt nhỏ (< 50 MB) để test luồng GEE không tốn hạn mức.
- Chuỗi KTTV giả lập theo định dạng thật của từng nguồn (dùng `nock` để mô phỏng dịch vụ ngoài).
- **Không dùng dữ liệu cá nhân thật** trong môi trường dev/staging.

## H.3. Kiểm thử đặc thù GIS

| Loại | Nội dung |
|---|---|
| Tính đúng hình học | So sánh diện tích/chiều dài tính bằng PostGIS với giá trị tham chiếu từ QGIS, sai số < 0,1% |
| Hệ tọa độ | Kiểm tra chuyển đổi EPSG:4326 ↔ VN-2000 múi 3° tại các điểm mốc đã biết |
| Topology | Lớp giao thông sau import phải thông tuyến (`pgr_analyzeGraph` không còn nút cô lập) |
| Import | Shapefile lỗi encoding (tiếng Việt trong .dbf), thiếu .prj, hình học không hợp lệ (`ST_IsValid`) |
| Raster | Kiểm tra NoData, độ phân giải, khung tọa độ sau khi cắt theo ranh giới |

## H.4. Kiểm thử phân quyền tự động (bắt buộc)

Sinh test từ `MA_TRAN_PHAN_QUYEN.csv` ánh xạ tới request trong Postman collection: với mỗi (`requestName`, `role`), khẳng định mã trạng thái mong đợi (401 khi không có token, 403 khi vai trò không có quyền, 2xx / mã mong đợi theo tài liệu API). Đồng thời tự động kiểm tra ca cách ly dữ liệu đa tổ chức (`org_id`) và ACL theo lớp (`gis.layer_permissions`).

```js
// tests/authz/matrix.test.js — phác thảo
describe.each(loadMatrixWithPostman('docs/MA_TRAN_PHAN_QUYEN.csv', 'docs/api/campha.postman_collection.json'))(
  '$requestName ($method $path)',
  ({ requestName, method, path, expected }) => {
    it.each(Object.entries(expected))('vai trò %s → mã %s', async (role, code) => {
      const token = await tokenFor(role);
      const res = await request(app)[method](path).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(Number(code));
    });
  }
);
```

Giá trị: khi ma trận quyền hoặc Postman contract thay đổi (rất dễ xảy ra với 27 module), test tự động phát hiện sai lệch thay vì phải rà thủ công.

## H.5. Tiêu chí chất lượng cho mỗi release

- Độ phủ nhánh toàn dự án ≥ 70%, phần code mới ≥ 75%.
- Không có lỗ hổng phụ thuộc mức High/Critical chưa xử lý.
- Không có phát hiện Semgrep mức ERROR.
- Toàn bộ test phân quyền xanh.
- k6: p95 < 800 ms (API đọc), < 3 s (API phân tích không gian) ở 500 VU.

---

# Phần I. DevOps & vận hành

## I.1. Môi trường

| Môi trường | Mục đích | Dữ liệu | Triển khai |
|---|---|---|---|
| `local` | Phát triển | Fixture | Node 24 + dịch vụ native local/VPS dev |
| `ci` | Unit/contract/security | Fixture không DB; integration chạy ở staging gate | GitHub Actions + staging DB tách biệt |
| `staging` | Demo sprint + DAST + UAT | Dữ liệu giả lập giống thật | Tự động từ `develop` |
| `production` | Vận hành | Dữ liệu thật | Thủ công có phê duyệt, từ tag trên `main` |

## I.2. Pipeline CI/CD

```
push → lint (ESLint) 
     → unit test 
     → integration test (PostgreSQL/PostGIS staging/test tách biệt)
     → coverage gate (≥70%)
     → npm audit --audit-level=high
     → Semgrep (ruleset: javascript, nodejs, owasp-top-ten)
     → gitleaks
     → build image
     → [develop] deploy staging → migration → smoke test → ZAP baseline
     → [tag v*] chờ phê duyệt → deploy production
```

## I.3. Nguyên tắc migration khi vận hành

- Migration chạy tự động khi deploy, **trước** khi container ứng dụng nhận traffic.
- Sử dụng PostgreSQL advisory lock (`SELECT pg_advisory_xact_lock(...)`) để đảm bảo chỉ 1 tiến độ runner thực hiện migration khi scale nhiều replica.
- Tính toán và lưu SHA256 checksum cho mỗi file migration; từ chối khởi động nếu file migration đã thi hành bị thay đổi nội dung.
- Thay đổi phá vỡ tương thích phải chia 2 bước (expand → contract) qua 2 release để không gián đoạn dịch vụ.
- Luôn sao lưu DB trước migration trên production; có kịch bản `down`/forward-fix thủ công đã qua kiểm thử.
- Tự động chạy smoke test kiểm tra tính hợp lệ của schema ngay sau migration và trước khi mở cổng nhận traffic.

## I.4. Sao lưu & khôi phục

| Đối tượng | Cách sao lưu | Tần suất | RPO | RTO |
|---|---|---|---|---|
| PostgreSQL | `pg_basebackup` + WAL archiving | Liên tục | 5 phút | 1 giờ |
| MinIO | Replication sang site phụ | Liên tục | 15 phút | 2 giờ |
| Cấu hình GeoServer | Sao lưu thư mục data_dir | Hằng ngày | 24 giờ | 1 giờ |
| Secret/khóa | Kho khóa riêng, sao lưu ngoại tuyến | Khi thay đổi | – | – |

## I.5. Giám sát

- **Kỹ thuật:** CPU/RAM/disk, độ trễ API (p50/p95/p99), tỷ lệ lỗi 5xx, kích thước hàng đợi BullMQ, số kết nối DB.
- **Nghiệp vụ:** độ trễ dữ liệu KTTV theo nguồn, số trạm mất tín hiệu, tỷ lệ job GEE thất bại, số phản ánh chờ duyệt, thời gian chạy mô hình.
- **An ninh:** số lần đăng nhập thất bại theo IP, số lần 403, lượt gọi vượt hạn mức API.

---

# Phần J. Rủi ro & điểm cần chốt

## J.1. Câu hỏi bắt buộc chốt với chủ đầu tư trước Sprint 0

Tài liệu tự nêu 4 điểm tại mục 6; cả 4 đều chặn thiết kế phân quyền:

1. **[ĐÃ CHỐT] UB được thêm/xóa ảnh vệ tinh.** Mục 2.1 Nhóm chức năng quản trị ghi rõ TNMT, QT, XD, UB được thêm mới, xóa, phân loại ảnh.
2. **Ranh giới vai trò QT.** Mục 2.1 xác nhận QT được quản trị kho ảnh vệ tinh; QT vẫn bị loại trừ quyền phân quyền và sửa/xóa **lớp dữ liệu bản đồ** theo mục 4.1. Hai loại tài nguyên `raster` và `layers` được tách riêng trong RBAC.
3. **Ranh giới cụm "chỉnh sửa dữ liệu" đối với UB:** mục 2.1 đã chốt kho ảnh vệ tinh; phạm vi với tin tức, văn bản thực hiện theo bảng chức năng tương ứng.
4. **Lỗi trong tài liệu gốc mục 3.2:** ghi "triển khai tại tỉnh Đắk Nông" trong khi dự án tại TP Cẩm Phả, Quảng Ninh. Cần bản đính chính.

Bổ sung từ phân tích kỹ thuật:

5. **Engine mô hình thủy văn–thủy lực dùng phần mềm nào?** (SWMM, HEC-RAS, MIKE, TUFLOW…). Quyết định này ảnh hưởng toàn bộ Sprint 11–12: định dạng file tham số, cách gọi, giấy phép, hạ tầng tính toán. **Chưa chốt thì không thể ước lượng chính xác Sprint 12.**
6. **Realtime dùng Socket.io hay giữ `ws`?** Tài liệu chỉ đích danh Socket.io; codebase đang dùng `ws`.
7. **Xác thực tài khoản cơ quan:** đã chốt local password + Google OAuth; không triển khai LDAP/AD trên VPS dùng chung.
8. **Hạ tầng triển khai:** máy chủ vật lý tại đơn vị hay thuê cloud? Ảnh hưởng phương án sao lưu, chứng thư số, và khả năng dùng Redis/worker riêng.
9. **Mâu thuẫn mới phát hiện — UB có được chạy mô hình không?** Bảng A.1-9 ghi UB **chỉ được xem** bộ tham số và kết quả kiểm định ("Nhập, chỉnh sửa, chạy thử, hiệu chỉnh: TNMT, XD, QT"), nhưng bảng A.2-10 lại ghi "Chạy mô hình, lưu kịch bản: **UB**, TNMT, XD, QT". Hai ô này nói về cùng một hành vi ở hai màn hình khác nhau. Kế hoạch tạm theo A.2-10 cho module dự báo và theo A.1-9 cho module tham số, đánh dấu trong CSV — cần chốt để tránh lỗ hổng phân quyền.
10. **Mâu thuẫn nhỏ — QT có được gửi ảnh giám sát hiện trạng không?** B-2 liệt kê "ND, UB, TNMT, XD" (không có QT), trong khi A.1-8 cho QT xem và thống kê nhưng không duyệt. Cần xác nhận QT chỉ có vai trò kỹ thuật, không tham gia nghiệp vụ.

## J.2. Bảng rủi ro

| # | Rủi ro | Xác suất | Tác động | Giảm thiểu |
|---|---|:--:|:--:|---|
| R1 | Thiếu số liệu hiệu chỉnh–kiểm định mô hình (mưa, mực nước, vết ngập của 2–3 trận lũ) | Cao | Rất cao — mô hình không kiểm định được, tài liệu nêu rõ "bắt buộc phải có" | Khởi động thu thập ngay Sprint 0; nếu thiếu, thu hẹp phạm vi A.1-9 xuống quản lý tham số, tách phần kiểm định thành hạng mục riêng |
| R2 | Không có DEM độ phân giải ≤ 5 m | Cao | Cao — không mô phỏng được ngập đô thị, không hiển thị 3D | Xác định nguồn sớm; dự phòng bay UAV hoặc dùng DEM 10 m và ghi rõ hạn chế |
| R3 | Chưa chốt engine thủy lực | Cao | Cao — chặn Sprint 12 | Chốt trước cuối Sprint 8 |
| R4 | Dịch vụ KTTV không cho truy cập lập trình hoặc không có văn bản chia sẻ dữ liệu | Trung bình | Cao | Đàm phán từ Sprint 0; dự phòng dùng nguồn mở (GSMaP, GPM IMERG, ERA5, Open-Meteo) |
| R5 | Hạn mức Google Earth Engine bị cạn | Trung bình | Trung bình | Hạn mức theo người dùng, cache kết quả, chạy ngoài giờ cao điểm |
| R6 | Dữ liệu mạng đường không thông tuyến → không tìm được đường đi ngắn nhất | Trung bình | Trung bình | Bước làm sạch topology bắt buộc trong Sprint 3, kiểm thử bằng `pgr_analyzeGraph` |
| R7 | Ma trận phân quyền thay đổi muộn | Trung bình | Trung bình | Sinh test từ CSV → thay đổi phát hiện tự động |
| R8 | Đội chưa quen PostGIS/GeoServer | Trung bình | Trung bình | Sprint 0 dành 20% thời gian đào tạo; 1 GIS engineer chuyên trách |
| R9 | Dữ liệu cá nhân trong phản ánh vi phạm Luật 91/2025/QH15 & NĐ 356/2025 | Thấp | Cao (pháp lý) | Thiết kế riêng tư từ đầu ở Sprint 8; rà soát pháp lý trước UAT |
| **R10** | **API thiết kế khi chưa có bên tiêu thụ.** App di động do chủ dự án tự làm *sau khi* backend xong (E.0); web client chưa có ai làm. Hợp đồng API không được client thực nghiệm thường phải sửa lại khi tích hợp | Cao | Trung bình | Chốt Postman collection **trước** khi code; collection đóng vai client thay thế (E.4a); dành quỹ sửa hợp đồng API ở S12b; mời cán bộ nghiệp vụ dự Review từ S5 |
| **R11** | **21 màn hình web (A.1-* + A.2-*) chưa có đơn vị thực hiện.** Khối lượng ~350–450 SP, xấp xỉ nửa phần server | Cao | **Rất cao** — hệ thống không dùng được dù server hoàn thành | Chốt nhà thầu/đội web **trước khi server tới S4**; nếu không kịp, đàm phán lại phạm vi nghiệm thu và mốc bàn giao với chủ đầu tư ngay từ bây giờ, đừng để tới lúc thanh quyết toán |
| **R12** | **Ước lượng chưa do đội thực hiện lập** (xem A.1b); velocity 45 SP/sprint là giả định | Cao | Trung bình | Biên độ ±20% khi trao đổi tiến độ; hiệu chỉnh bắt buộc ở US-3.8 cuối Sprint 3 |

## J.3. Giả định đang áp dụng

Khi chưa có phản hồi cho mục J.1, kế hoạch này giả định:

- Vai trò QT **bị loại trừ** quyền phân quyền và sửa/xóa lớp dữ liệu bản đồ; mục 2.1 xác nhận QT vẫn được thêm/xóa/phân loại ảnh vệ tinh.
- "Chỉnh sửa dữ liệu" đối với UB **chỉ giới hạn ở lớp dữ liệu bản đồ**; UB được quản trị kho ảnh vệ tinh, tin tức, văn bản, bản đồ PDF theo các bảng chức năng tương ứng.
- Quyền ảnh vệ tinh đã chốt: UB, TNMT, XD, QT được thêm mới, xóa, phân loại; không còn là `ASSUMPTION`.
- Engine mô hình là **phần mềm ngoài**, hệ thống chỉ quản lý tham số và điều phối chạy.
- Toàn bộ mốc địa lý là **TP Cẩm Phả, tỉnh Quảng Ninh** (bỏ qua lỗi "Đắk Nông" trong tài liệu gốc).

---

## Phụ lục 1. Bảng ánh xạ module → sprint

| Module | Tên | Sprint |
|---|---|---|
| A.1-1 | Quản trị ảnh vệ tinh | 6a |
| A.1-2 | Quản trị lớp dữ liệu bản đồ | 2, 3 |
| A.1-3 | Quản trị người dùng | 1 |
| A.1-4 | Quản trị văn bản, báo cáo | 5 |
| A.1-5 | Quản trị API lớp dữ liệu | 13 |
| A.1-6 | Quản trị tin tức | 5 |
| A.1-7 | Quản trị bản đồ PDF | 5 |
| A.1-8 | Quản trị cập nhật từ mobile | 8 |
| A.1-9 | Tham số mô hình thủy văn–thủy lực (7.6) | 11, 12 (cổng: SPIKE-8.8) |
| A.1-10 | Cấu hình KTTV trực tuyến (7.7) | 10a, 10b |
| A.2-1 | Tương tác lớp bản đồ | 4 |
| A.2-2 | Tương tác ảnh vệ tinh | 6a (xem, so sánh), 6b (phân loại) |
| A.2-3 | Thống kê | 7 |
| A.2-4 | Phân tích không gian | 7 |
| A.2-5 | Tin tức | 5 |
| A.2-6 | Bản đồ PDF | 5 |
| A.2-7 | Báo cáo | 5 |
| A.2-8 | Đăng nhập | 1 |
| A.2-9 | Đăng ký | 1 |
| A.2-10 | Dự báo xu hướng ngập | 12 |
| A.2-11 | Gửi phản ánh | 8 |
| B-1 | Mobile: tương tác lớp bản đồ | 9a (xem, đo, vẽ), 9b (tìm đường, sửa dữ liệu) |
| B-2 | Mobile: giám sát hiện trạng | 8 |
| B-3 | Mobile: đăng nhập | 1 |
| B-4 | Mobile: đăng ký | 1 |
| B-5 | Mobile: tin tức | 5 |
| B-6 | Mobile: văn bản, báo cáo | 5 |

## Phụ lục 2. Danh mục dữ liệu phải thu thập trước khi bắt đầu module tương ứng

> **Đây là hạng mục công việc, không phải bảng theo dõi.** Toàn bộ 17 dòng dưới đây phải có owner rõ ràng. Dự án dùng hai bí danh ổn định để phù hợp nhóm triển khai hai người:
>
> - **Owner A — Trưởng dự án:** điều phối phòng ban, nghiệp vụ, tài khoản, quyết định và hợp đồng.
> - **Owner B — Cộng sự kỹ thuật:** GIS, dữ liệu không gian, viễn thám và mô hình.
>
> Mốc lịch dưới đây lấy **Sprint 3 bắt đầu 03/08/2026**, mỗi sprint kéo dài 2 tuần. Deadline là ngày làm việc cuối cùng trước sprint cần dữ liệu. Khi lịch sprint được hiệu chỉnh ở US-3.8, Owner A cập nhật đồng bộ các mốc tương lai.
>
> Cột "Trạng thái" chỉ nhận 4 giá trị: `Đã có` · `Đã cam kết + ngày` · `Đang đàm phán` · `Chưa liên hệ`.

| Dữ liệu | Cần trước sprint | Người chịu trách nhiệm | Hạn chót | Trạng thái |
|---|---|---|---|---|
| 7 lớp nền địa lý TP Cẩm Phả | 3 | Owner B | 31/07/2026 | `Chưa liên hệ` |
| Ranh giới phường/xã kèm mã đơn vị hành chính | 3 | Owner B | 31/07/2026 | `Chưa liên hệ` |
| DEM/DTM ≤ 5 m | 4 | Owner B | 14/08/2026 | `Chưa liên hệ` — **Rủi ro R2** |
| Hiện trạng sử dụng đất 2015/2020/2025 | 6b | Owner B | 25/09/2026 | `Chưa liên hệ` |
| Phân bố dân cư | 7 | Owner A | 09/10/2026 | `Chưa liên hệ` |
| Mạng lưới thoát nước (kênh, cống, hồ điều hòa, trạm bơm) | 11 | Owner B | 31/12/2026 | `Chưa liên hệ` |
| Mạng lưới giao thông đã xử lý topology | 9b | Owner B | 20/11/2026 | `Chưa liên hệ` — **Rủi ro R6** |
| Công trình xây dựng mới theo năm + giấy phép xây dựng | 7 | Owner A | 09/10/2026 | `Chưa liên hệ` |
| Ngập lụt lịch sử (vết ngập, độ sâu, thời gian, thiệt hại) | 12 | Owner B | 15/01/2027 | `Chưa liên hệ` |
| Mẫu huấn luyện phân loại | 6b | Owner B | 25/09/2026 | `Chưa liên hệ` |
| Mặt cắt ngang sông/kênh/mương | 11 | Owner B | 31/12/2026 | `Chưa liên hệ` |
| Chuỗi mực nước triều tại cửa xả ra vịnh Bái Tử Long | 11 | Owner B | 31/12/2026 | `Chưa liên hệ` |
| Số liệu 2–3 trận lũ điển hình để hiệu chỉnh–kiểm định | 12 | Owner B | 15/01/2027 | `Chưa liên hệ` — **Rủi ro R1, có thể làm hỏng cả A.1-9** |
| Tài khoản + khóa dịch vụ KTTV, danh mục trạm, cấp báo động I/II/III | 10a | Owner A | 04/12/2026 | `Chưa liên hệ` — **Rủi ro R4** |
| Tài khoản Google Earth Engine | 6b | Owner B | 25/09/2026 | `Đã có` |
| **Quyết định engine mô hình thủy lực** | **8 (SPIKE-8.8)** | **Owner A** | **23/10/2026** | `Đang đàm phán` — **Chặn S11 — J.1-5** |
| **Nhóm thực hiện 21 màn hình web** | **trước S4** | **Owner A** | **14/08/2026** | `Đã có` — **nhóm dự án hai người** |
