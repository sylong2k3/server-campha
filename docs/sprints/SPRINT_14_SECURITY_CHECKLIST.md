# Sprint 14 — Security acceptance

## Policy

- Target: OWASP ASVS 4.0.3 Level 2 + OWASP API Security Top 10 2023.
- Automated checks là evidence hỗ trợ, không thay pentest độc lập.
- Nghiệm thu yêu cầu High/Critical = 0; findings khác có owner/deadline.

| Risk/control | Evidence hiện có | Manual/independent evidence | Status |
|---|---|---|---|
| API1 BOLA / ASVS V4,V8 | DB/service ownership, layer ACL, 404 denial integration | Cross-org ID enumeration | Automated covered; manual pending |
| API2 Authentication | JWT rotation/blacklist, lockout, OAuth tests | Session fixation/token replay | Automated covered; manual pending |
| API3 Property authorization | Joi strict, field allowlists, shared registry fields | Mass-assignment fuzzing | Automated covered; manual pending |
| API4 Resource consumption | Body limit, global/routed quota, DB/server timeout | Slowloris, zip/raster/live load | Automated covered; manual pending |
| API5 Function authorization | DB permissions + hard role gates | Full 5-role endpoint matrix | Automated covered; manual pending |
| API6 Sensitive business flows | Comment/auth/share quotas | Abuse workflow review | Pending |
| API7 SSRF | Fixed upstream bases, identifier validation, redirect disabled | DNS rebinding/outbound firewall | Automated covered; manual pending |
| API8 Misconfiguration | Helmet CSP, strict CORS, secret env validation | TLS/Nginx/cipher/port scan | Automated covered; manual pending |
| API9 Inventory | Postman sole contract; route inventory | Zombie/deprecated endpoint review | Pending |
| API10 Unsafe API consumption | Timeout, error sanitization, schema validation | Upstream compromise scenarios | Automated covered; manual pending |

## Sprint 14 negative tests

- Security headers/CSP and `x-powered-by` absent.
- ETag/304 and cache policy.
- Oversized JSON 413 without stack disclosure.
- Metrics 404 disabled; 401 wrong/missing bearer; no token in output.
- Metadata XML escaping and strict schema.
- Spatial dynamic identifiers remain allowlisted.

## Independent pentest gate

Tester độc lập nhận Postman collection, role fixtures, staging URL, scope exclusions. Báo cáo phải gồm CVSS/severity, reproduction, endpoint, remediation, retest. Không đánh dấu hoàn tất cho đến khi có signed report và High/Critical = 0.