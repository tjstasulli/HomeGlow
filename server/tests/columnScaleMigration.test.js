// Two-phase test for schema migration 30 (column scale x4):
// 1) boot a fresh server (migrates to latest), create a widget assignment
//    with a known pre-scale layout via the real API, stop the server;
// 2) revert the DB's schema id to 29 (no structural change needed - the
//    fixture rows the API wrote are already valid at every schema version);
// 3) boot again - migration 30 re-runs - and assert the layout quadrupled.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { freePort } = require('./freePort');

const serverDir = path.resolve(__dirname, '..');
const tmpDir = path.resolve(__dirname, '.tmp');
const testDbPath = path.join(tmpDir, `column-scale-migration-${process.pid}-${Date.now()}.db`);
const keepTestArtifacts = process.env.HOMEGLOW_TEST_KEEP_ARTIFACTS === '1';
let port;
let baseUrl;

async function usePort() {
    port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
}

let serverProcess;
let serverLogs = '';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetch(`${baseUrl}/api/test`);
            if (response.ok) return;
        } catch {
            // Server is still starting.
        }
        await delay(250);
    }
    throw new Error(`Server did not become ready within ${timeoutMs}ms. Logs:\n${serverLogs}`);
}

async function startServer() {
    await usePort();
    serverProcess = spawn('node', ['index.js'], {
        cwd: serverDir,
        env: {
            ...process.env,
            PORT: String(port),
            DB_PATH: testDbPath,
            TZ: 'UTC',
            HOMEGLOW_DISABLE_BACKGROUND_JOBS: '1',
            HOMEGLOW_DISABLE_CALENDAR_SYNC: '1',
            ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
    serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });
    return waitForServerReady();
}

async function stopServer() {
    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
        await new Promise((resolve) => {
            serverProcess.once('close', () => resolve());
            setTimeout(resolve, 5000);
        });
    }
}

test.after(async () => {
    await stopServer();
    if (!keepTestArtifacts) {
        for (const suffix of ['', '-shm', '-wal', '-journal']) {
            const filePath = `${testDbPath}${suffix}`;
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
    }
});

test('schema 30 multiplies layout_x and layout_w by 4 for existing widget assignments', async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const DEVICE = `fixture-device-${process.pid}`;

    // Phase 1: boot at the latest schema, create a real assignment with a
    // known pre-scale layout through the actual API.
    await startServer();
    const createResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widget_name: 'chores', tabNumber: 1 }),
    });
    assert.equal(createResponse.status, 200);

    const bulkResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments/layout/bulk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            layouts: [{ widget_name: 'chores', tabNumber: 1, layout_x: 3, layout_y: 10, layout_w: 6, layout_h: 8 }],
        }),
    });
    assert.equal(bulkResponse.status, 200);

    // A second widget assigned but never laid out: layout_x/w stay null.
    const createUnlaidResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widget_name: 'calendar', tabNumber: 1 }),
    });
    assert.equal(createUnlaidResponse.status, 200);

    await stopServer();

    // Phase 2: revert only the schema id - the fixture rows the API wrote are
    // already valid rows at any schema version.
    const db = new Database(testDbPath);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('29', 'SYSTEM_SCHEMA_ID');
    db.close();

    // Phase 3: boot again - migration 30 re-runs against the fixture rows.
    await startServer();
    const assignmentsResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments`);
    assert.equal(assignmentsResponse.status, 200);
    const assignments = await assignmentsResponse.json();
    const chores = assignments.find((a) => a.widget_name === 'chores');
    const calendar = assignments.find((a) => a.widget_name === 'calendar');

    assert.ok(chores, 'chores assignment present after migration');
    assert.equal(chores.layout_x, 12, 'layout_x x4: 3 -> 12');
    assert.equal(chores.layout_w, 24, 'layout_w x4: 6 -> 24');
    assert.equal(chores.layout_y, 10, 'layout_y unchanged (row unit, not touched by this migration)');
    assert.equal(chores.layout_h, 8, 'layout_h unchanged (row unit, not touched by this migration)');

    assert.ok(calendar, 'calendar assignment present after migration');
    assert.equal(calendar.layout_x, null, 'an unset layout_x stays null, not coerced to 0');
    assert.equal(calendar.layout_w, null, 'an unset layout_w stays null, not coerced to 0');
});
