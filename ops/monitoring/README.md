# Native monitoring

Không Docker. Prometheus/Grafana chạy native systemd, bind local/private interface. Nginx không public `/metrics`; Prometheus scrape HTTPS nội bộ bằng bearer token file mode `0600`.

1. Sinh `METRICS_TOKEN` ngẫu nhiên tối thiểu 32 ký tự; đặt API `METRICS_ENABLED=true`.
2. Ghi cùng token vào `/etc/prometheus/secrets/campha-metrics-token`, owner `prometheus`, mode `0600`.
3. Copy config/rules, chạy `promtool check config` và `promtool check rules`.
4. Reload Prometheus. Grafana dùng Prometheus datasource, không commit credential.
5. Alert hiện chỉ cho HTTP, DB pool, layer import/cleanup. Không KTTV/GEE.