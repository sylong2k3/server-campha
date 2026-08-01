require('dotenv').config({ quiet: true });

const baseUrl = process.env.API_BASE_URL || 'http://127.0.0.1:3005';
const password = process.env.API_TEST_PASSWORD;
const accounts = [
    ['system_admin', 'admin@campha.gov.vn'],
    ['ubnd_tp', 'ubnd@campha.gov.vn'],
    ['so_tnmt', 'tnmt@campha.gov.vn'],
    ['so_xd', 'xaydung@campha.gov.vn'],
    ['citizen', 'citizen@campha.gov.vn'],
];

const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, options);
    const body = await response.json();
    return { response, body };
};

(async () => {
    const health = await request('/health');
    if (health.response.status !== 200 || health.body.status !== 'OK') {
        throw new Error(`Health failed: HTTP ${health.response.status}`);
    }

    const unauthorized = await request('/api/v1/auth/me');
    if (unauthorized.response.status !== 401) {
        throw new Error(`Expected /me HTTP 401, got ${unauthorized.response.status}`);
    }

    if (!password) {
        console.log('API public smoke passed; set API_TEST_PASSWORD to verify five seeded roles.');
        return;
    }

    for (const [role, email] of accounts) {
        const login = await request('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        if (login.response.status !== 200 || !login.body.data?.accessToken) {
            throw new Error(`Login failed for ${role}: HTTP ${login.response.status}`);
        }
    }
    console.log('API smoke passed: health, 401 and five seeded roles.');
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
