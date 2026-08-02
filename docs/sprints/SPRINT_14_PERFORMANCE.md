# Sprint 14 — Performance evidence

## Automated EXPLAIN

`src/database/__tests__/integration/sprint14-spatial-performance.integration.test.js` tạo 100.000 điểm trên `campha_test`, `ANALYZE`, chạy `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Acceptance: GiST index path xuất hiện; count giống truy vấn exact cũ.

Các API MVT/nearby dùng native-SRID bbox prefilter trước transform/metric exact.

## k6 staging

```bash
BASE_URL=https://staging.example.vn READ_TOKEN='...' LAYER_ID=123 k6 run tests/load/sprint14-read.js
BASE_URL=https://staging.example.vn k6 run tests/load/sprint14-basemap-anonymous.js
```

- Ramp 100 → 500 VU; giữ 500 VU trong 5 phút.
- Acceptance: `http_req_duration p(95)<800ms`, `http_req_failed<1%`.
- `sprint14-read.js`: endpoint có bearer, chỉ token read-only; không production; không ghi token vào report.
- `sprint14-basemap-anonymous.js`: endpoint public `/api/v1/web-map/basemaps`, cố ý không gửi `Authorization` để đo đúng nhánh `optionalAuth` bỏ qua Passport.

## Result record

| Thời gian            | Môi trường                                                          | Commit                             | Dataset                              |  VU | Requests |      RPS |       avg |           p95 |       Max |     Error | Kết quả                 |
| -------------------- | ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------ | --: | -------: | -------: | --------: | ------------: | --------: | --------: | ----------------------- |
| 02/08/2026 11:39 +07 | Local Windows, Node + PostgreSQL cùng máy, `campha_test`, port 3014 | `0bbb4b8` + ETag check fix         | 1 layer metadata fixture             | 500 |   93.982 |   893,66 | 215,24 ms | **365,62 ms** | 990,02 ms | **0,00%** | Đạt local               |
| 02/08/2026 13:17 +07 | Local Windows, optimized anonymous basemap, access log off          | `aa82087` pre-deploy               | Public basemap catalog cache 60 giây | 500 |  194.674 | 1.851,89 |  0,211 ms |  **0,584 ms** |  15,05 ms | **0,00%** | Đạt pre-deploy          |
| 02/08/2026 12:46 +07 | VPS staging trực tiếp HTTP `:3006`, chưa Nginx/TLS                  | `d3e682e` deployed                 | Public basemap catalog               | 500 |  138.668 |   192,57 |    1,53 s |    **2,98 s** |    4,72 s | **0,00%** | **Không đạt latency**   |
| 02/08/2026 13:27 +07 | VPS staging trực tiếp HTTP `:3006`, chưa Nginx/TLS                  | `aa82087` deployed, access log off | Public basemap catalog cache 60 giây | 500 |  205.573 |   285,49 | 967,64 ms |    **1,67 s** |    2,72 s | **0,00%** | **Cải thiện, chưa đạt** |

Điều kiện benchmark local: ramp 100 → 500 VU, giữ 500 VU 60 giây, sleep 200 ms; global limiter nâng riêng trong process test (`RATE_LIMIT_MAX=1000000`). Rate limit production không đổi. Tất cả 93.982 response trả HTTP 200. ETag được xác minh riêng; k6 v2 dùng key `headers.Etag` và contract đã sửa từ `headers.ETag`.

Pre-deploy optimized smoke dùng cùng 500 VU nhưng endpoint public: anonymous request bỏ Passport khi không có `Authorization`, basemap cache RAM 60 giây có in-flight deduplication, `HTTP_ACCESS_LOG_ENABLED=false`. So với local public path trước tối ưu chưa có phép đo cùng điều kiện; kết quả này chỉ chứng minh code mới không bão hòa local, chưa dự đoán chính xác VPS.

> [!NOTE]
> Hai dòng benchmark endpoint basemap public ở trên (13:17 và 13:27) được chạy trước khi `tests/load/sprint14-basemap-anonymous.js` được commit — không có script tương ứng trong repo tại thời điểm đó nên không tái lập được chính xác. `sprint14-basemap-anonymous.js` hiện đã có sẵn cho lần retest tiếp theo trên endpoint này.

Điều kiện staging: full contract 12 phút (2 phút → 100 VU, 3 phút → 500 VU, giữ 500 VU 5 phút, ramp-down 2 phút), `RATE_LIMIT_MAX` và `WEB_MAP_RATE_LIMIT` tạm nâng 1.000.000. Tất cả response hai lần chạy trả HTTP 200 và có ETag. `aa82087` tăng throughput từ 192,57 lên 285,49 RPS (+48,3%), giảm avg từ 1,53 giây xuống 967,64 ms (-36,8%), giảm p95 từ 2,98 xuống 1,67 giây (-44,0%). VPS vẫn bão hòa dưới 500 VU; p95 còn vượt mục tiêu 2,1 lần.

Lần chạy chẩn đoán đầu local bị 99,74% HTTP 429 do global limiter mặc định 1.000 request/15 phút; đó là policy rejection, không phải backend saturation. Sau khi chỉ nâng limiter benchmark, error = 0%.

> [!WARNING]
> Staging **chưa đạt** p95 < 800 ms ở 500 VU dù tối ưu đã cải thiện rõ rệt. Bước tiếp theo cần profiling tài nguyên VPS hoặc scale nhiều Node process; không tiếp tục tối ưu code mù. Khôi phục `RATE_LIMIT_MAX=1000`, `WEB_MAP_RATE_LIMIT=120`, `HTTP_ACCESS_LOG_ENABLED=true` sau benchmark.
