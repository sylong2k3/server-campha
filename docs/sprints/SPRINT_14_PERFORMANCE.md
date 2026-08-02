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

Điều kiện benchmark local: ramp 100 → 500 VU, giữ 500 VU 60 giây, sleep 200 ms; global limiter nâng riêng trong process test (`RATE_LIMIT_MAX=1000000`). Rate limit production không đổi. Tất cả 93.982 response trả HTTP 200. ETag được xác minh riêng; k6 v2 dùng key `headers.Etag` và contract đã sửa từ `headers.ETag`.

Lần chạy chẩn đoán đầu bị 99,74% HTTP 429 do global limiter mặc định 1.000 request/15 phút; đó là policy rejection, không phải backend saturation. Sau khi chỉ nâng limiter benchmark, error = 0%.

> [!IMPORTANT]
> Local đã vượt mục tiêu p95 < 800 ms ở 500 VU. Staging/VPS sau Nginx/TLS/network vẫn phải chạy full contract 12 phút trước production; không suy diễn local thành staging certification.