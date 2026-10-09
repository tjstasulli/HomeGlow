const context = globalThis.__HOMEGLOW_SCHEMA_MIGRATION_CONTEXT;

if (!context || !context.db) {
    throw new Error('Schema migration context is missing for migration');
}

const { db, schemaIdKey, targetSchemaId } = context;

// NORMALIZED_GRID_COLS (client/src/utils/gridLayout.js) is widening 12 -> 48
// to give horizontal resize the same finer-grained precision the row pitch
// already has, so a widget's stored column-unit fields must quadruple to
// land in the same proportional place on the new, finer normalized grid.
// layout_y/layout_h stay as they are: those are row units, untouched by this
// migration (see schema29, which already scaled them for the row pitch).
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

const COLUMN_SCALE = 4;

try {
    console.log(`=== Starting column scale migration to version ${targetSchemaId} ===`);

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
                if (entry.layout_x != null && Number.isFinite(Number(entry.layout_x))) {
                    entry.layout_x = Number(entry.layout_x) * COLUMN_SCALE;
                    changed = true;
                }
                if (entry.layout_w != null && Number.isFinite(Number(entry.layout_w))) {
                    entry.layout_w = Number(entry.layout_w) * COLUMN_SCALE;
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
        console.log(`=== Column scale migration completed successfully (version ${targetSchemaId}) ===`);
    } catch (migrationError) {
        db.exec('ROLLBACK');
        throw migrationError;
    }
} catch (error) {
    console.error('=== Column scale migration failed ===');
    console.error('Error:', error);
    throw error;
}
