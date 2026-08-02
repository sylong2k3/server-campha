import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.BASE_URL;
if (!baseUrl) {throw new Error('BASE_URL is required');}

export const options = {
  scenarios: {
    basemap_anonymous: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 100 },
        { duration: '3m', target: 500 },
        { duration: '5m', target: 500 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Cố ý không gửi Authorization — đây là endpoint public, và optionalAuth
  // (src/middlewares/auth.middleware.js) bỏ qua hoàn toàn Passport khi thiếu
  // header đó. Gửi kèm Authorization sẽ đo nhầm nhánh code khác.
  const params = { tags: { sprint: '14', type: 'basemap_anonymous' } };
  const response = http.get(`${baseUrl}/api/v1/web-map/basemaps`, params);
  check(response, { 'basemap 200': (r) => r.status === 200, 'has ETag': (r) => Boolean(r.headers.Etag) });
  sleep(0.2);
}
