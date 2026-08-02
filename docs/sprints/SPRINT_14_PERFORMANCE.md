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

| Thời gian | Commit | Dataset | VU | RPS | p95 | Error | Kết quả |
|---|---|---:|---:|---:|---:|---:|---|
| Chưa chạy staging | — | — | 500 | — | — | — | Pending |

Không suy diễn kết quả load từ localhost/unit test.