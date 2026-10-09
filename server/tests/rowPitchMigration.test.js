// Two-phase test for schema migration 29 (row pitch x2):
// 1) boot a fresh server (migrates to latest), create a widget assignment
//    with a known pre-scale layout via the real API, stop the server;
// 2) revert the DB's schema id to 28 (no structural change needed - the
//    fixture row the API wrote is already valid at every schema version);
// 3) boot again - migration 29 re-runs - and assert the layout doubled.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const Database = require('better-sqlite3');
const { freePort } = require('./freePort');

const serverDir = path.resolve(__dirname, '..');
const tmpDir = path.resolve(__dirname, '.tmp');
const testDbPath = path.join(tmpDir, `row-pitch-migration-${process.pid}-${Date.now()}.db`);
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
        serverProcess.kill();
        await delay(300);
    }
}

test('schema 29 doubles layout_y and layout_h for existing widget assignments', async () => {
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
            layouts: [{ widget_name: 'chores', tabNumber: 1, layout_x: 0, layout_y: 5, layout_w: 6, layout_h: 4 }],
        }),
    });
    assert.equal(bulkResponse.status, 200);
    await stopServer();

    // Phase 2: revert only the schema id - the fixture row the API wrote is
    // already a valid row at any schema version, so no structural change is
    // needed, unlike a migration that adds/removes a column.
    const db = new Database(testDbPath);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('28', 'SYSTEM_SCHEMA_ID');
    db.close();

    // Phase 3: boot again - migration 29 re-runs against the fixture row.
    await startServer();
    const assignmentsResponse = await fetch(`${baseUrl}/api/devices/${DEVICE}/widget-assignments`);
    assert.equal(assignmentsResponse.status, 200);
    const assignments = await assignmentsResponse.json();
    const chores = assignments.find((a) => a.widget_name === 'chores');

    assert.ok(chores, 'chores assignment present after migration');
    assert.equal(chores.layout_x, 0, 'layout_x unchanged (normalized column unit)');
    assert.equal(chores.layout_w, 6, 'layout_w unchanged (normalized column unit)');
    assert.equal(chores.layout_y, 10, 'layout_y doubled: 5 -> 10');
    assert.equal(chores.layout_h, 8, 'layout_h doubled: 4 -> 8');

    await stopServer();
});
