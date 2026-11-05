/**
 * Browser tests: the real app in a real browser. See E2E-TESTS.md.
 *
 *   npm run test:e2e
 *
 * The app is started for you on port 3210 against a disposable database (see e2e/env.js), with sign-in switched
 * off so the tests can pretend to be different people. Rules that depend on a real Azure sign-in are covered by
 * the server tests (npm test), not here.
 */
const { defineConfig } = require('@playwright/test');
const { baseURL, dbUrl, PORT } = require('./e2e/env');

module.exports = defineConfig({
    testDir: './e2e',
    testMatch: '**/*.spec.js',
    timeout: 30000,
    expect: { timeout: 8000 },
    // One database is shared, so tests run one at a time
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list'], ['html', { open: 'never' }]],
    globalSetup: require.resolve('./e2e/global-setup'),
    globalTeardown: require.resolve('./e2e/global-teardown'),
    use: {
        baseURL,
        viewport: { width: 1400, height: 900 },
        timezoneId: 'Africa/Johannesburg',   // the office's time zone, so "today" means the same to the browser and the server
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    webServer: {
        command: 'node server.js',
        url: `${baseURL}/api/me`,
        reuseExistingServer: false,
        timeout: 60000,
        stdout: 'pipe',
        env: {
            NODE_ENV: 'test',
            PORT: String(PORT),
            DB_PROVIDER: 'postgres',
            DATABASE_URL: dbUrl,
            DB_SSL: 'disable',
            // Set explicitly (even to nothing) so a developer's .env can never leak in
            REQUIRE_AUTH: 'false',
            AZURE_AD_TENANT_ID: '',
            AZURE_AD_CLIENT_ID: '',
            ADMIN_EMAILS: '',
            CORS_ORIGINS: '',
            RATE_LIMIT_MAX: '100000',
            RATE_LIMIT_ANON_MAX: '100000',
            RATE_LIMIT_IP_MAX: '100000'
        }
    }
});
