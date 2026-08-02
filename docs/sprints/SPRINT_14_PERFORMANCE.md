# Sprint 14 — Performance evidence

## Automated EXPLAIN

`src/database/__tests__/integration/sprint14-spatial-performance.integration.test.js` tạo 100.000 điểm trên `campha_test`, `ANALYZE`, chạy `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Acceptance: GiST index path xuất hiện; count giống truy vấn exact cũ.

Các API MVT/nearby dùng native-SRID bbox prefilter trước transform/metric exact.

## k6 staging

```bash
BASE_URL=https://staging.example.vn READ_TOKEN='...' LAYER_ID=123 k6 run tests/load/sprint14-read.js
```

- Ramp 100 → 500 VU; giữ 500 VU trong 5 phút.
- Acceptance: `http_req_duration p(95)<800ms`, `http_req_failed<1%`.
- Chỉ token read-only; không production; không ghi token vào report.

## Result record

| Thời gian | Môi trường | Commit | Dataset | VU | Requests | RPS | avg | p95 | Max | Error | Kết quả |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 02/08/2026 11:39 +07 | Local Windows, Node + PostgreSQL cùng máy, `campha_test`, port 3014 | `0bbb4b8` + ETag check fix | 1 layer metadata fixture | 500 | 93.982 | 893,66 | 215,24 ms | **365,62 ms** | 990,02 ms | **0,00%** | Đạt local |
| 02/08/2026 12:46 +07 | VPS staging trực tiếp HTTP `:3006`, chưa Nginx/TLS | `d3e682e` deployed | Public basemap catalog | 500 | 138.668 | 192,57 | 1,53 s | **2,98 s** | 4,72 s | **0,00%** | **Không đạt latency** |

Điều kiện benchmark local: ramp 100 → 500 VU, giữ 500 VU 60 giây, sleep 200 ms; global limiter nâng riêng trong process test (`RATE_LIMIT_MAX=1000000`). Rate limit production không đổi. Tất cả 93.982 response trả HTTP 200. ETag được xác minh riêng; k6 v2 dùng key `headers.Etag` và contract đã sửa từ `headers.ETag`.

Điều kiện staging: full contract 12 phút (2 phút → 100 VU, 3 phút → 500 VU, giữ 500 VU 5 phút, ramp-down 2 phút), `RATE_LIMIT_MAX` và `WEB_MAP_RATE_LIMIT` tạm nâng 1.000.000. Tất cả 138.668 response trả HTTP 200 và có ETag; error threshold đạt nhưng p95 vượt mục tiêu 3,7 lần. Sau tải, 10 request đơn có latency 23–128 ms, trung bình 38,9 ms: hệ thống hồi phục, nhưng bão hòa dưới 500 VU.

Lần chạy chẩn đoán đầu local bị 99,74% HTTP 429 do global limiter mặc định 1.000 request/15 phút; đó là policy rejection, không phải backend saturation. Sau khi chỉ nâng limiter benchmark, error = 0%.

> [!WARNING]
> Staging **chưa đạt** p95 < 800 ms ở 500 VU. Không nghiệm thu hiệu năng production cho đến khi có profiling CPU/event-loop/DB pool trong lúc tải và retest đạt. Khôi phục `RATE_LIMIT_MAX=1000`, `WEB_MAP_RATE_LIMIT=120` sau benchmark.