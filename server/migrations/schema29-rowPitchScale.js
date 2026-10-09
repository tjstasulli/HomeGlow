const context = globalThis.__HOMEGLOW_SCHEMA_MIGRATION_CONTEXT;

if (!context || !context.db) {
    throw new Error('Schema migration context is missing for migration');
}

const { db, schemaIdKey, targetSchemaId } = context;

// The grid's row pitch (client/src/utils/gridMetrics.js) is halving (116px ->
// 58px, GRID_PITCH), so a widget's stored row-unit fields must double to keep
// its on-screen height exactly what it was. layout_x/layout_w stay as they
// are: those are normalized 12-column units, already independent of pixel
// pitch.
function parseConfigJson(configJson) {
    if (!configJson) return {};
    try {
        const parsed = JSON.parse(configJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch {
        // Ignore malformed JSON and fall back to empty object.
    }
    return {};
}

const ROW_PITCH_SCALE = 2;

try {
    console.log(`=== Starting row pitch scale migration to version ${targetSchemaId} ===`);

    db.exec('BEGIN');
    try {
        const tabs = db.prepare('SELECT id, config_json FROM tabs').all();
        const updateTab = db.prepare('UPDATE tabs SET config_json = ? WHERE id = ?');

        tabs.forEach((tab) => {
            const layout = parseConfigJson(tab.config_json);
            let changed = false;
            Object.keys(layout).forEach((widgetName) => {
                const entry = layout[widgetName];
                if (!entry || typeof entry !== 'object') return;
                if (Number.isFinite(Number(entry.layout_y))) {
                    entry.layout_y = Number(entry.layout_y) * ROW_PITCH_SCALE;
                    changed = true;
                }
                if (Number.isFinite(Number(entry.layout_h))) {
                    entry.layout_h = Number(entry.layout_h) * ROW_PITCH_SCALE;
                    changed = true;
                }
            });
            if (changed) {
                updateTab.run(JSON.stringify(layout), tab.id);
            }
        });

        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
            schemaIdKey,
            String(targetSchemaId)
        );
        db.exec('COMMIT');
        console.log(`=== Row pitch scale migration completed successfully (version ${targetSchemaId}) ===`);
    } catch (migrationError) {
        db.exec('ROLLBACK');
        throw migrationError;
    }
} catch (error) {
    console.error('=== Row pitch scale migration failed ===');
    console.error('Error:', error);
    throw error;
}
