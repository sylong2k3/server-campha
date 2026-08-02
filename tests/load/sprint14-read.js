import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.BASE_URL;
const token = __ENV.READ_TOKEN;
const layerId = __ENV.LAYER_ID;
if (!baseUrl || !token || !layerId) {throw new Error('BASE_URL, READ_TOKEN and LAYER_ID are required');}

export const options = {
  scenarios: {
    read_api: {
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
  const params = { headers: { Authorization: `Bearer ${token}` }, tags: { sprint: '14', type: 'read' } };
  const response = http.get(`${baseUrl}/api/v1/admin/layers/${layerId}`, params);
  check(response, { 'read 200': (r) => r.status === 200, 'has ETag': (r) => Boolean(r.headers.Etag) });
  sleep(0.2);
}