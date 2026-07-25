use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

struct DbState {
    conn: Mutex<Option<Connection>>,
    path: Mutex<Option<String>>,
}

#[derive(Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub not_null: bool,
    pub default_value: Option<String>,
    pub primary_key: bool,
}

#[derive(Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: Option<u64>,
}

const INVENTORY_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon VARCHAR(10) DEFAULT '📋',
    color VARCHAR(20) DEFAULT '#5b6abf',
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS category_attribute_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    attr_key VARCHAR(100) NOT NULL,
    attr_type VARCHAR(20) DEFAULT 'string',
    is_required INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    UNIQUE(category_id, attr_key)
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    base_unit_name VARCHAR(50) NOT NULL DEFAULT 'unit',
    reorder_threshold NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attr_key VARCHAR(100) NOT NULL,
    attr_value TEXT NOT NULL,
    data_type VARCHAR(20) DEFAULT 'string'
);

CREATE TABLE IF NOT EXISTS unit_conversions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    conversion_factor NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    sub_location VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    batch_number VARCHAR(100),
    supplier_name VARCHAR(255),
    unit_cost_price NUMERIC(12, 2) NOT NULL,
    purchase_date DATE NOT NULL,
    status VARCHAR(30) DEFAULT 'in_inventory' CHECK (status IN ('ordered', 'shipping', 'arrived', 'in_inventory', 'used', 'reserved')),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS inventory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    location_id INTEGER REFERENCES locations(id),
    quantity_change NUMERIC(10, 2) NOT NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('PURCHASE', 'USAGE', 'SPOILAGE', 'ADJUSTMENT')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    title VARCHAR(255),
    body TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    company VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
    reserved_date DATE NOT NULL,
    fulfilled_date DATE,
    status VARCHAR(30) DEFAULT 'reserved' CHECK (status IN ('reserved', 'partial', 'fulfilled', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('purchase', 'shipping', 'delivery', 'tasting', 'reservation', 'custom')),
    event_date DATE NOT NULL,
    end_date DATE,
    quantity NUMERIC(10, 2),
    notes TEXT,
    is_completed INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('low_stock', 'expiry', 'custom', 'reorder', 'reservation')),
    message TEXT NOT NULL,
    threshold_value NUMERIC(10, 2),
    is_active INTEGER DEFAULT 1,
    last_triggered TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_attributes_product ON product_attributes(product_id);
CREATE INDEX IF NOT EXISTS idx_templates_category ON category_attribute_templates(category_id);
CREATE INDEX IF NOT EXISTS idx_batches_product_date ON batches(product_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_logs_batch ON inventory_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON inventory_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_product ON product_notes(product_id);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_reservations_client ON client_reservations(client_id);
CREATE INDEX IF NOT EXISTS idx_reservations_product ON client_reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_calendar_product ON calendar_events(product_id);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_notifications_product ON product_notifications(product_id);
";

const SEED_DATA: &str = "
INSERT INTO categories (name, description, icon, color) VALUES
('Red Wine', 'Full-bodied red varieties', '🍷', '#dc2626'),
('White Wine', 'Crisp and aromatic whites', '🥂', '#eab308'),
('Rosé', 'Rosé wines and blush varieties', '🌸', '#ec4899'),
('Sparkling', 'Champagne and sparkling wines', '🍾', '#f59e0b'),
('Fortified', 'Port, sherry, and fortified wines', '🫙', '#ea580c'),
('Spirits', 'Hard liquor and spirits', '🍸', '#7c3aed'),
('Tobacco', 'Cigars, cigarettes, and tobacco products', '🚬', '#78716c'),
('Accessories', 'Glassware, tools, and accessories', '📦', '#2563eb');

INSERT INTO category_attribute_templates (category_id, attr_key, attr_type, is_required, display_order) VALUES
(1, 'Vintage', 'number', 1, 1),
(1, 'Region', 'string', 1, 2),
(1, 'ABV', 'string', 0, 3),
(1, 'Grape', 'string', 0, 4),
(2, 'Vintage', 'number', 1, 1),
(2, 'Region', 'string', 1, 2),
(2, 'ABV', 'string', 0, 3),
(3, 'Vintage', 'number', 1, 1),
(3, 'Region', 'string', 1, 2),
(3, 'ABV', 'string', 0, 3),
(4, 'Vintage', 'number', 1, 1),
(4, 'Region', 'string', 1, 2),
(4, 'ABV', 'string', 0, 3),
(5, 'Age', 'string', 0, 1),
(5, 'Region', 'string', 1, 2),
(5, 'ABV', 'string', 0, 3),
(6, 'Type', 'string', 1, 1),
(6, 'ABV', 'string', 0, 2),
(7, 'Type', 'string', 1, 1),
(7, 'Origin', 'string', 0, 2),
(7, 'Strength', 'string', 0, 3),
(8, 'Material', 'string', 0, 1),
(8, 'Capacity', 'string', 0, 2);

INSERT INTO locations (name, sub_location) VALUES ('Main Cellar', 'Rack A, Shelf 1');
INSERT INTO locations (name, sub_location) VALUES ('Main Cellar', 'Rack A, Shelf 2');
INSERT INTO locations (name, sub_location) VALUES ('Main Cellar', 'Rack B, Shelf 1');
INSERT INTO locations (name, sub_location) VALUES ('Cold Storage', 'Section 1');
INSERT INTO locations (name, sub_location) VALUES ('Warehouse', 'Ground Level');

INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES
(1, 'Château Margaux 2015', 'WINE-R-001', 'bottle', 6),
(1, 'Penfolds Grange 2018', 'WINE-R-002', 'bottle', 4),
(1, 'Opus One 2019', 'WINE-R-003', 'bottle', 6),
(2, 'Cloudy Bay Sauvignon Blanc 2022', 'WINE-W-001', 'bottle', 12),
(2, 'Chablis Premier Cru 2020', 'WINE-W-002', 'bottle', 8),
(3, 'Whispering Angel 2023', 'WINE-RS-001', 'bottle', 10),
(4, 'Dom Pérignon 2013', 'WINE-SP-001', 'bottle', 4),
(4, 'Moët & Chandon Impérial', 'WINE-SP-002', 'bottle', 8),
(5, 'Taylor\'s 20 Year Tawny Port', 'WINE-F-001', 'bottle', 6),
(6, 'Hendrick\'s Gin', 'SPIR-001', 'bottle', 4),
(6, 'Macallan 12 Year Highland Scotch', 'SPIR-002', 'bottle', 4),
(7, 'Riedel Vinum Bordeaux Glasses (Set of 2)', 'ACC-001', 'set', 2);

INSERT INTO product_attributes (product_id, attr_key, attr_value, data_type) VALUES
(1, 'Vintage', '2015', 'number'),
(1, 'Region', 'Bordeaux, France', 'string'),
(1, 'ABV', '13.5%', 'string'),
(1, 'Grape', 'Cabernet Sauvignon Blend', 'string'),
(2, 'Vintage', '2018', 'number'),
(2, 'Region', 'South Australia', 'string'),
(2, 'ABV', '14.5%', 'string'),
(2, 'Grape', 'Shiraz', 'string'),
(3, 'Vintage', '2019', 'number'),
(3, 'Region', 'Napa Valley, California', 'string'),
(3, 'ABV', '14.5%', 'string'),
(4, 'Vintage', '2022', 'number'),
(4, 'Region', 'Marlborough, NZ', 'string'),
(4, 'ABV', '13.0%', 'string'),
(5, 'Vintage', '2020', 'number'),
(5, 'Region', 'Burgundy, France', 'string'),
(5, 'ABV', '12.5%', 'string'),
(6, 'Vintage', '2023', 'number'),
(6, 'Region', 'Provence, France', 'string'),
(6, 'ABV', '13.0%', 'string'),
(7, 'Vintage', '2013', 'number'),
(7, 'Region', 'Champagne, France', 'string'),
(7, 'ABV', '12.5%', 'string'),
(8, 'Region', 'Champagne, France', 'string'),
(8, 'ABV', '12.0%', 'string'),
(9, 'Age', '20 Year', 'string'),
(9, 'Region', 'Douro, Portugal', 'string'),
(9, 'ABV', '20.0%', 'string'),
(10, 'Type', 'London Dry Gin', 'string'),
(10, 'ABV', '41.4%', 'string'),
(11, 'Age', '12 Year', 'string'),
(11, 'Region', 'Highland, Scotland', 'string'),
(11, 'ABV', '40.0%', 'string'),
(12, 'Material', 'Crystal Glass', 'string'),
(12, 'Capacity', '620ml', 'string');

INSERT INTO unit_conversions (product_id, unit_name, conversion_factor) VALUES
(1, 'Case', 12),
(1, 'Half Case', 6),
(2, 'Case', 12),
(3, 'Case', 12),
(4, 'Case', 12),
(4, 'Pack', 6),
(5, 'Case', 12),
(6, 'Case', 12),
(7, 'Case', 6),
(8, 'Case', 12),
(9, 'Case', 12),
(10, 'Case', 6),
(11, 'Case', 6),
(12, 'Case', 4);

INSERT INTO batches (product_id, batch_number, supplier_name, unit_cost_price, purchase_date, notes) VALUES
(1, 'LOT-2024-001', 'Grand Cru Distributors', 485.00, '2024-01-15', 'Initial stock purchase'),
(1, 'LOT-2024-012', 'Grand Cru Distributors', 510.00, '2024-06-20', 'Restock - price increase'),
(2, 'LOT-2024-002', 'Southern Vintners Pty', 725.00, '2024-02-10', 'Direct import'),
(3, 'LOT-2024-003', 'Napa Valley Imports', 420.00, '2024-03-05', ''),
(4, 'LOT-2024-004', 'Pacific Wines Ltd', 22.50, '2024-04-12', 'Summer stock'),
(4, 'LOT-2024-015', 'Pacific Wines Ltd', 24.00, '2024-09-01', 'Restock'),
(5, 'LOT-2024-005', 'Burgundy Imports Co', 38.00, '2024-01-20', ''),
(6, 'LOT-2024-006', 'Provence Wines SA', 18.50, '2024-05-01', 'Rosé season stock'),
(7, 'LOT-2024-007', 'Champagne Elite Ltd', 285.00, '2024-02-14', 'Valentine stock'),
(8, 'LOT-2024-008', 'Champagne Elite Ltd', 38.00, '2024-03-01', ''),
(9, 'LOT-2024-009', 'Portuguese Fine Wines', 52.00, '2024-04-10', ''),
(10, 'LOT-2024-010', 'Spirits International', 32.00, '2024-01-25', ''),
(11, 'LOT-2024-011', 'Highland Spirits Co', 68.00, '2024-05-15', ''),
(12, 'LOT-2024-013', 'Riedel Direct', 95.00, '2024-02-01', 'Glassware restock'),
(12, 'LOT-2024-014', 'Riedel Direct', 95.00, '2024-08-01', 'Additional stock');

INSERT INTO inventory_logs (batch_id, location_id, quantity_change, transaction_type, notes, created_at) VALUES
(1, 1, 24.00, 'PURCHASE', 'Initial stock - 2 cases', '2024-01-15 10:00:00'),
(1, 1, -2.00, 'USAGE', 'Served at private tasting event', '2024-02-10 19:30:00'),
(1, 1, -1.00, 'USAGE', 'Opened for VIP dinner', '2024-03-15 20:00:00'),
(2, 1, 12.00, 'PURCHASE', 'Restock - 1 case', '2024-06-20 11:00:00'),
(3, 1, 12.00, 'PURCHASE', 'Initial stock - 1 case', '2024-02-10 09:30:00'),
(3, 1, -1.00, 'USAGE', 'Wine pairing dinner', '2024-04-05 20:15:00'),
(4, 2, 24.00, 'PURCHASE', 'Initial stock - 2 cases', '2024-03-05 14:00:00'),
(4, 2, -3.00, 'USAGE', 'Weekend service', '2024-04-01 18:00:00'),
(5, 3, 48.00, 'PURCHASE', 'Summer stock - 4 cases', '2024-04-12 10:00:00'),
(5, 3, -6.00, 'USAGE', 'Summer event service', '2024-07-04 17:00:00'),
(5, 3, -2.00, 'SPOILAGE', 'Cork taint detected', '2024-08-15 09:00:00'),
(6, 3, 24.00, 'PURCHASE', 'Restock - 2 cases', '2024-09-01 11:00:00'),
(7, 1, 12.00, 'PURCHASE', 'Initial stock - 1 case', '2024-01-20 10:00:00'),
(7, 1, -1.00, 'USAGE', 'Tasting flight', '2024-03-01 16:00:00'),
(8, 4, 24.00, 'PURCHASE', 'Valentine stock - 2 cases', '2024-05-01 09:00:00'),
(8, 4, -4.00, 'USAGE', 'Valentine event', '2024-05-14 19:00:00'),
(9, 1, 6.00, 'PURCHASE', 'Initial stock - 1 case', '2024-02-14 10:30:00'),
(9, 1, -1.00, 'USAGE', 'Dessert service', '2024-03-20 21:00:00'),
(10, 2, 24.00, 'PURCHASE', 'Initial stock - 2 cases', '2024-03-01 11:00:00'),
(10, 2, -2.00, 'USAGE', 'Bar service', '2024-04-15 22:00:00'),
(11, 2, 12.00, 'PURCHASE', 'Initial stock - 1 case', '2024-04-10 14:00:00'),
(11, 2, -1.00, 'USAGE', 'Neat pours', '2024-05-20 20:00:00'),
(12, 4, 12.00, 'PURCHASE', 'Initial stock - 1 case', '2024-05-15 10:00:00'),
(12, 4, -1.00, 'USAGE', 'Tasting flight', '2024-06-10 17:00:00'),
(13, 5, 8.00, 'PURCHASE', 'Initial stock - 2 cases', '2024-02-01 09:00:00'),
(13, 5, -2.00, 'USAGE', 'Event glasses', '2024-03-15 18:00:00'),
(14, 5, 8.00, 'PURCHASE', 'Additional stock - 2 cases', '2024-08-01 10:00:00');
";

fn get_conn<'a>(state: &'a State<'a, DbState>) -> Result<std::sync::MutexGuard<'a, Option<Connection>>, String> {
    state.conn.lock().map_err(|e| e.to_string())
}

fn get_active_conn<'a>(conn_lock: &'a std::sync::MutexGuard<'a, Option<Connection>>) -> Result<&'a Connection, String> {
    conn_lock.as_ref().ok_or_else(|| "No database connected".to_string())
}

#[tauri::command]
fn open_database(path: String, state: State<DbState>) -> Result<TableInfo, String> {
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;
    let mut conn_lock = get_conn(&state)?;
    *conn_lock = Some(conn);
    let mut path_lock = state.path.lock().map_err(|e| e.to_string())?;
    *path_lock = Some(path.clone());
    drop(conn_lock);
    drop(path_lock);
    get_schema(state)
}

#[tauri::command]
fn create_new_database(path: String, state: State<DbState>) -> Result<TableInfo, String> {
    let conn = Connection::open(&path).map_err(|e| format!("Failed to create database: {}", e))?;
    conn.execute_batch(INVENTORY_SCHEMA)
        .map_err(|e| format!("Failed to create schema: {}", e))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
    conn.execute_batch(SEED_DATA)
        .map_err(|e| format!("Failed to seed data: {}", e))?;
    let mut conn_lock = get_conn(&state)?;
    *conn_lock = Some(conn);
    let mut path_lock = state.path.lock().map_err(|e| e.to_string())?;
    *path_lock = Some(path.clone());
    drop(conn_lock);
    drop(path_lock);
    get_schema(state)
}

#[tauri::command]
fn get_schema(state: State<DbState>) -> Result<TableInfo, String> {
    let conn_lock = get_conn(&state)?;
    let _conn = get_active_conn(&conn_lock)?;
    Ok(TableInfo {
        name: String::new(),
        columns: vec![],
    })
}

#[tauri::command]
fn get_tables(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| format!("Failed to query tables: {}", e))?;
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Failed to read tables: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tables)
}

#[tauri::command]
fn get_table_columns(table: String, state: State<DbState>) -> Result<Vec<ColumnInfo>, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let pragma = format!("PRAGMA table_info('{}')", table.replace('\'', "''"));
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| format!("Failed to query columns: {}", e))?;
    let columns = stmt
        .query_map([], |row| {
            Ok(ColumnInfo {
                name: row.get(1)?,
                data_type: row.get(2)?,
                not_null: row.get::<_, bool>(3)?,
                default_value: row.get(4).ok(),
                primary_key: row.get::<_, bool>(5)?,
            })
        })
        .map_err(|e| format!("Failed to read columns: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(columns)
}

#[tauri::command]
fn execute_query(sql: String, state: State<DbState>) -> Result<QueryResult, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let trimmed = sql.trim().to_uppercase();

    if trimmed.starts_with("SELECT") || trimmed.starts_with("PRAGMA") || trimmed.starts_with("EXPLAIN") {
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("SQL error: {}", e))?;
        let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let num_cols = stmt.column_count();
        let mut rows = Vec::new();
        let mut rows_affected = 0u64;
        let rows_result = stmt
            .query_map([], |row| {
                let mut values = Vec::new();
                for i in 0..num_cols {
                    // Try string first, then i64, then f64, then null
                    let val: serde_json::Value = if let Ok(Some(s)) = row.get::<_, Option<String>>(i) {
                        if let Ok(n) = s.parse::<i64>() {
                            serde_json::Value::Number(n.into())
                        } else if let Ok(f) = s.parse::<f64>() {
                            serde_json::Value::Number(
                                serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
                            )
                        } else {
                            serde_json::Value::String(s)
                        }
                    } else if let Ok(n) = row.get::<_, i64>(i) {
                        serde_json::Value::Number(n.into())
                    } else if let Ok(f) = row.get::<_, f64>(i) {
                        serde_json::Value::Number(
                            serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
                        )
                    } else {
                        serde_json::Value::Null
                    };
                    values.push(val);
                }
                Ok(values)
            })
            .map_err(|e| format!("SQL execution error: {}", e))?;
        for row in rows_result {
            if let Ok(values) = row {
                rows.push(values);
                rows_affected += 1;
            }
        }
        Ok(QueryResult { columns: col_names, rows, rows_affected: Some(rows_affected) })
    } else {
        let rows_affected = conn.execute(&sql, [])
            .map_err(|e| format!("SQL execution error: {}", e))?;
        Ok(QueryResult { columns: vec![], rows: vec![], rows_affected: Some(rows_affected as u64) })
    }
}

#[tauri::command]
fn get_table_data(table: String, limit: Option<u32>, state: State<DbState>) -> Result<QueryResult, String> {
    let lim = limit.unwrap_or(100);
    let sql = format!("SELECT * FROM '{}' LIMIT {}", table.replace('\'', "''"), lim);
    execute_query(sql, state)
}

#[tauri::command]
fn get_database_path(state: State<DbState>) -> Result<Option<String>, String> {
    let path_lock = state.path.lock().map_err(|e| e.to_string())?;
    Ok(path_lock.clone())
}

#[tauri::command]
fn close_database(state: State<DbState>) -> Result<(), String> {
    let mut conn_lock = get_conn(&state)?;
    *conn_lock = None;
    let mut path_lock = state.path.lock().map_err(|e| e.to_string())?;
    *path_lock = None;
    Ok(())
}

#[tauri::command]
fn migrate_schema(state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    // Batch status
    conn.execute_batch("ALTER TABLE batches ADD COLUMN status VARCHAR(30) DEFAULT 'in_inventory';").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);").ok();
    // Category enhancements
    conn.execute_batch("ALTER TABLE categories ADD COLUMN description TEXT;").ok();
    conn.execute_batch("ALTER TABLE categories ADD COLUMN icon VARCHAR(10) DEFAULT '📋';").ok();
    conn.execute_batch("ALTER TABLE categories ADD COLUMN color VARCHAR(20) DEFAULT '#5b6abf';").ok();
    // Category attribute templates
    conn.execute_batch("CREATE TABLE IF NOT EXISTS category_attribute_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, attr_key VARCHAR(100) NOT NULL, attr_type VARCHAR(20) DEFAULT 'string', is_required INTEGER DEFAULT 0, display_order INTEGER DEFAULT 0, UNIQUE(category_id, attr_key));").ok();
    // Product notes
    conn.execute_batch("CREATE TABLE IF NOT EXISTS product_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, title VARCHAR(255), body TEXT NOT NULL, is_pinned INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
    // Clients
    conn.execute_batch("CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(50), company VARCHAR(255), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
    // Client reservations
    conn.execute_batch("CREATE TABLE IF NOT EXISTS client_reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, quantity NUMERIC(10, 2) NOT NULL DEFAULT 1, reserved_date DATE NOT NULL, fulfilled_date DATE, status VARCHAR(30) DEFAULT 'reserved' CHECK (status IN ('reserved', 'partial', 'fulfilled', 'cancelled')), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
    // Calendar events
    conn.execute_batch("CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('purchase', 'shipping', 'delivery', 'tasting', 'reservation', 'custom')), event_date DATE NOT NULL, end_date DATE, quantity NUMERIC(10, 2), notes TEXT, is_completed INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
    // Notifications
    conn.execute_batch("CREATE TABLE IF NOT EXISTS product_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('low_stock', 'expiry', 'custom', 'reorder', 'reservation')), message TEXT NOT NULL, threshold_value NUMERIC(10, 2), is_active INTEGER DEFAULT 1, last_triggered TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
    // Indexes
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_templates_category ON category_attribute_templates(category_id);").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_notes_product ON product_notes(product_id);").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_reservations_client ON client_reservations(client_id);").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_reservations_product ON client_reservations(product_id);").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_calendar_product ON calendar_events(product_id);").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(event_date);").ok();
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_notifications_product ON product_notifications(product_id);").ok();
    Ok(())
}

#[tauri::command]
fn update_batch_status(batch_id: i64, status: String, state: State<DbState>) -> Result<(), String> {
    let valid = ["ordered", "shipping", "arrived", "in_inventory", "used", "reserved"];
    if !valid.contains(&status.as_str()) {
        return Err(format!("Invalid status: {}. Must be one of: {}", status, valid.join(", ")));
    }
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let sql = format!("UPDATE batches SET status = '{}' WHERE id = {}", status.replace('\'', "''"), batch_id);
    conn.execute(&sql, []).map_err(|e| format!("Failed to update batch status: {}", e))?;
    Ok(())
}

#[tauri::command]
fn delete_inventory_log(log_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM inventory_logs WHERE id = {}", log_id), [])
        .map_err(|e| format!("Failed to delete inventory log: {}", e))?;
    Ok(())
}

#[tauri::command]
fn update_inventory_log_notes(log_id: i64, notes: Option<String>, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let notes_val = match notes {
        Some(n) => format!("'{}'", n.replace('\'', "''")),
        None => "NULL".to_string(),
    };
    conn.execute(&format!("UPDATE inventory_logs SET notes = {} WHERE id = {}", notes_val, log_id), [])
        .map_err(|e| format!("Failed to update log notes: {}", e))?;
    Ok(())
}

#[tauri::command]
fn update_product(product_id: i64, name: String, sku: Option<String>, category_id: Option<i64>, base_unit_name: String, reorder_threshold: f64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let sku_val = match sku {
        Some(s) => format!("'{}'", s.replace('\'', "''")),
        None => "NULL".to_string(),
    };
    let cat_val = match category_id {
        Some(c) => c.to_string(),
        None => "NULL".to_string(),
    };
    let sql = format!(
        "UPDATE products SET name = '{}', sku = {}, category_id = {}, base_unit_name = '{}', reorder_threshold = {} WHERE id = {}",
        name.replace('\'', "''"), sku_val, cat_val, base_unit_name.replace('\'', "''"), reorder_threshold, product_id
    );
    conn.execute(&sql, []).map_err(|e| format!("Failed to update product: {}", e))?;
    Ok(())
}

#[tauri::command]
fn upsert_product_attribute(product_id: i64, attr_key: String, attr_value: String, data_type: String, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let existing: Option<i64> = conn.query_row(
        &format!("SELECT id FROM product_attributes WHERE product_id = {} AND attr_key = '{}'", product_id, attr_key.replace('\'', "''")),
        [],
        |row| row.get(0),
    ).ok();
    match existing {
        Some(id) => {
            conn.execute(
                &format!("UPDATE product_attributes SET attr_value = '{}', data_type = '{}' WHERE id = {}",
                    attr_value.replace('\'', "''"), data_type.replace('\'', "''"), id),
                [],
            ).map_err(|e| format!("Failed to update attribute: {}", e))?;
            Ok(id)
        }
        None => {
            conn.execute(
                &format!("INSERT INTO product_attributes (product_id, attr_key, attr_value, data_type) VALUES ({}, '{}', '{}', '{}')",
                    product_id, attr_key.replace('\'', "''"), attr_value.replace('\'', "''"), data_type.replace('\'', "''")),
                [],
            ).map_err(|e| format!("Failed to insert attribute: {}", e))?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn update_unit_conversion(conversion_id: i64, unit_name: String, conversion_factor: f64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(
        &format!("UPDATE unit_conversions SET unit_name = '{}', conversion_factor = {} WHERE id = {}",
            unit_name.replace('\'', "''"), conversion_factor, conversion_id),
        [],
    ).map_err(|e| format!("Failed to update unit conversion: {}", e))?;
    Ok(())
}

#[tauri::command]
fn upsert_category(name: String, description: Option<String>, icon: Option<String>, color: Option<String>, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let desc = description.map(|d| format!("'{}'", d.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    let ico = icon.unwrap_or_else(|| "📋".to_string());
    let col = color.unwrap_or_else(|| "#5b6abf".to_string());
    // Try update first
    let existing: Option<i64> = conn.query_row(
        &format!("SELECT id FROM categories WHERE name = '{}'", name.replace('\'', "''")),
        [],
        |row| row.get(0),
    ).ok();
    match existing {
        Some(id) => {
            conn.execute(
                &format!("UPDATE categories SET description = {}, icon = '{}', color = '{}' WHERE id = {}",
                    desc, ico.replace('\'', "''"), col.replace('\'', "''"), id),
                [],
            ).map_err(|e| format!("Failed to update category: {}", e))?;
            Ok(id)
        }
        None => {
            conn.execute(
                &format!("INSERT INTO categories (name, description, icon, color) VALUES ('{}', {}, '{}', '{}')",
                    name.replace('\'', "''"), desc, ico.replace('\'', "''"), col.replace('\'', "''")),
                [],
            ).map_err(|e| format!("Failed to create category: {}", e))?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn delete_category(category_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM category_attribute_templates WHERE category_id = {}", category_id), []).ok();
    conn.execute(&format!("UPDATE products SET category_id = NULL WHERE category_id = {}", category_id), [])
        .map_err(|e| format!("Failed to unassign products: {}", e))?;
    conn.execute(&format!("DELETE FROM categories WHERE id = {}", category_id), [])
        .map_err(|e| format!("Failed to delete category: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_category_templates(category_id: i64, state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let mut stmt = conn.prepare(
        &format!("SELECT id, attr_key, attr_type, is_required, display_order FROM category_attribute_templates WHERE category_id = {} ORDER BY display_order", category_id)
    ).map_err(|e| format!("Failed to query templates: {}", e))?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "attr_key": row.get::<_, String>(1)?,
            "attr_type": row.get::<_, String>(2)?,
            "is_required": row.get::<_, bool>(3)?,
            "display_order": row.get::<_, i64>(4)?
        }))
    }).map_err(|e| format!("Failed to read templates: {}", e))?;
    let mut result = Vec::new();
    for row in rows {
        if let Ok(r) = row { result.push(r); }
    }
    Ok(result)
}

#[tauri::command]
fn upsert_category_template(category_id: i64, attr_key: String, attr_type: String, is_required: bool, display_order: i64, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let existing: Option<i64> = conn.query_row(
        &format!("SELECT id FROM category_attribute_templates WHERE category_id = {} AND attr_key = '{}'", category_id, attr_key.replace('\'', "''")),
        [],
        |row| row.get(0),
    ).ok();
    match existing {
        Some(id) => {
            conn.execute(
                &format!("UPDATE category_attribute_templates SET attr_type = '{}', is_required = {}, display_order = {} WHERE id = {}",
                    attr_type.replace('\'', "''"), is_required as i32, display_order, id),
                [],
            ).map_err(|e| format!("Failed to update template: {}", e))?;
            Ok(id)
        }
        None => {
            conn.execute(
                &format!("INSERT INTO category_attribute_templates (category_id, attr_key, attr_type, is_required, display_order) VALUES ({}, '{}', '{}', {}, {})",
                    category_id, attr_key.replace('\'', "''"), attr_type.replace('\'', "''"), is_required as i32, display_order),
                [],
            ).map_err(|e| format!("Failed to create template: {}", e))?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn delete_category_template(template_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM category_attribute_templates WHERE id = {}", template_id), [])
        .map_err(|e| format!("Failed to delete template: {}", e))?;
    Ok(())
}

// === Product Notes ===
#[tauri::command]
fn upsert_product_note(product_id: i64, title: Option<String>, body: String, is_pinned: bool, note_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let title_val = title.map(|t| format!("'{}'", t.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    match note_id {
        Some(id) => {
            conn.execute(&format!("UPDATE product_notes SET title = {}, body = '{}', is_pinned = {}, updated_at = CURRENT_TIMESTAMP WHERE id = {}",
                title_val, body.replace('\'', "''"), is_pinned as i32, id), []).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(&format!("INSERT INTO product_notes (product_id, title, body, is_pinned) VALUES ({}, {}, '{}', {})",
                product_id, title_val, body.replace('\'', "''"), is_pinned as i32), []).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn delete_product_note(note_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM product_notes WHERE id = {}", note_id), []).map_err(|e| e.to_string())?;
    Ok(())
}

// === Clients ===
#[tauri::command]
fn upsert_client(name: String, email: Option<String>, phone: Option<String>, company: Option<String>, notes: Option<String>, client_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let email_val = email.map(|e| format!("'{}'", e.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    let phone_val = phone.map(|p| format!("'{}'", p.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    let company_val = company.map(|c| format!("'{}'", c.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    let notes_val = notes.map(|n| format!("'{}'", n.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    match client_id {
        Some(id) => {
            conn.execute(&format!("UPDATE clients SET name = '{}', email = {}, phone = {}, company = {}, notes = {} WHERE id = {}",
                name.replace('\'', "''"), email_val, phone_val, company_val, notes_val, id), []).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(&format!("INSERT INTO clients (name, email, phone, company, notes) VALUES ('{}', {}, {}, {}, {})",
                name.replace('\'', "''"), email_val, phone_val, company_val, notes_val), []).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn delete_client(client_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM client_reservations WHERE client_id = {}", client_id), []).ok();
    conn.execute(&format!("DELETE FROM clients WHERE id = {}", client_id), []).map_err(|e| e.to_string())?;
    Ok(())
}

// === Reservations ===
#[tauri::command]
fn upsert_reservation(client_id: i64, product_id: i64, quantity: f64, reserved_date: String, status: Option<String>, notes: Option<String>, fulfilled_date: Option<String>, reservation_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let status_val = status.unwrap_or_else(|| "reserved".to_string());
    let notes_val = notes.map(|n| format!("'{}'", n.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    let fulfilled_val = fulfilled_date.map(|d| format!("'{}'", d.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    match reservation_id {
        Some(id) => {
            conn.execute(&format!("UPDATE client_reservations SET client_id = {}, product_id = {}, quantity = {}, reserved_date = '{}', status = '{}', notes = {}, fulfilled_date = {} WHERE id = {}",
                client_id, product_id, quantity, reserved_date.replace('\'', "''"), status_val.replace('\'', "''"), notes_val, fulfilled_val, id), []).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(&format!("INSERT INTO client_reservations (client_id, product_id, quantity, reserved_date, status, notes, fulfilled_date) VALUES ({}, {}, {}, '{}', '{}', {}, {})",
                client_id, product_id, quantity, reserved_date.replace('\'', "''"), status_val.replace('\'', "''"), notes_val, fulfilled_val), []).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn delete_reservation(reservation_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM client_reservations WHERE id = {}", reservation_id), []).map_err(|e| e.to_string())?;
    Ok(())
}

// === Calendar Events ===
#[tauri::command]
fn upsert_calendar_event(product_id: Option<i64>, title: String, event_type: String, event_date: String, end_date: Option<String>, quantity: Option<f64>, notes: Option<String>, event_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let pid = product_id.map(|p| p.to_string()).unwrap_or_else(|| "NULL".to_string());
    let end_val = end_date.map(|d| format!("'{}'", d.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    let qty_val = quantity.map(|q| q.to_string()).unwrap_or_else(|| "NULL".to_string());
    let notes_val = notes.map(|n| format!("'{}'", n.replace('\'', "''"))).unwrap_or_else(|| "NULL".to_string());
    match event_id {
        Some(id) => {
            conn.execute(&format!("UPDATE calendar_events SET product_id = {}, title = '{}', event_type = '{}', event_date = '{}', end_date = {}, quantity = {}, notes = {} WHERE id = {}",
                pid, title.replace('\'', "''"), event_type.replace('\'', "''"), event_date.replace('\'', "''"), end_val, qty_val, notes_val, id), []).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(&format!("INSERT INTO calendar_events (product_id, title, event_type, event_date, end_date, quantity, notes) VALUES ({}, '{}', '{}', '{}', {}, {}, {})",
                pid, title.replace('\'', "''"), event_type.replace('\'', "''"), event_date.replace('\'', "''"), end_val, qty_val, notes_val), []).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn toggle_calendar_event(event_id: i64, is_completed: bool, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("UPDATE calendar_events SET is_completed = {} WHERE id = {}", is_completed as i32, event_id), []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_calendar_event(event_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM calendar_events WHERE id = {}", event_id), []).map_err(|e| e.to_string())?;
    Ok(())
}

// === Notifications ===
#[tauri::command]
fn upsert_notification(product_id: i64, notification_type: String, message: String, threshold_value: Option<f64>, is_active: bool, notification_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    let thresh_val = threshold_value.map(|t| t.to_string()).unwrap_or_else(|| "NULL".to_string());
    match notification_id {
        Some(id) => {
            conn.execute(&format!("UPDATE product_notifications SET notification_type = '{}', message = '{}', threshold_value = {}, is_active = {} WHERE id = {}",
                notification_type.replace('\'', "''"), message.replace('\'', "''"), thresh_val, is_active as i32, id), []).map_err(|e| e.to_string())?;
            Ok(id)
        }
        None => {
            conn.execute(&format!("INSERT INTO product_notifications (product_id, notification_type, message, threshold_value, is_active) VALUES ({}, '{}', '{}', {}, {})",
                product_id, notification_type.replace('\'', "''"), message.replace('\'', "''"), thresh_val, is_active as i32), []).map_err(|e| e.to_string())?;
            Ok(conn.last_insert_rowid())
        }
    }
}

#[tauri::command]
fn delete_notification(notification_id: i64, state: State<DbState>) -> Result<(), String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;
    conn.execute(&format!("DELETE FROM product_notifications WHERE id = {}", notification_id), []).map_err(|e| e.to_string())?;
    Ok(())
}

// === Product Report Data ===
#[tauri::command]
fn get_product_report_data(product_id: i64, state: State<DbState>) -> Result<serde_json::Value, String> {
    let conn_lock = get_conn(&state)?;
    let conn = get_active_conn(&conn_lock)?;

    let product: serde_json::Value = conn.query_row(&format!(
        "SELECT p.id, p.name, p.sku, COALESCE(c.name, 'Uncategorized'), COALESCE(c.icon, '📋'), COALESCE(c.color, '#5b6abf')
         FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = {}", product_id), [],
        |row| Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?, "name": row.get::<_, String>(1)?, "sku": row.get::<_, Option<String>>(2)?,
            "category": row.get::<_, String>(3)?, "icon": row.get::<_, String>(4)?, "color": row.get::<_, String>(5)?
        }))
    ).map_err(|e| e.to_string())?;

    let attrs: Vec<serde_json::Value> = {
        let mut stmt = conn.prepare(&format!("SELECT attr_key, attr_value, data_type FROM product_attributes WHERE product_id = {} ORDER BY attr_key", product_id)).map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt.query_map([], |row| Ok(serde_json::json!({"key": row.get::<_, String>(0)?, "value": row.get::<_, String>(1)?, "type": row.get::<_, String>(2)?}))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        rows
    };

    let history: Vec<serde_json::Value> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT il.transaction_type, SUM(ABS(il.quantity_change)) as total_qty, strftime('%Y-%m', il.created_at) as month
             FROM inventory_logs il JOIN batches b ON il.batch_id = b.id WHERE b.product_id = {} GROUP BY il.transaction_type, month ORDER BY month", product_id)).map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt.query_map([], |row| Ok(serde_json::json!({"type": row.get::<_, String>(0)?, "qty": row.get::<_, f64>(1)?, "month": row.get::<_, String>(2)?}))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        rows
    };

    let cost_data: Vec<serde_json::Value> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT b.purchase_date, b.unit_cost_price, SUM(COALESCE(il2.quantity_change, 0)) as stock
             FROM batches b LEFT JOIN inventory_logs il2 ON il2.batch_id = b.id AND il2.transaction_type = 'PURCHASE'
             WHERE b.product_id = {} GROUP BY b.id ORDER BY b.purchase_date", product_id)).map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt.query_map([], |row| Ok(serde_json::json!({"date": row.get::<_, String>(0)?, "cost": row.get::<_, f64>(1)?, "stock": row.get::<_, f64>(2)?}))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        rows
    };

    let notes: Vec<serde_json::Value> = {
        let mut stmt = conn.prepare(&format!("SELECT id, title, body, is_pinned, created_at FROM product_notes WHERE product_id = {} ORDER BY is_pinned DESC, created_at DESC", product_id)).map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt.query_map([], |row| Ok(serde_json::json!({"id": row.get::<_, i64>(0)?, "title": row.get::<_, Option<String>>(1)?, "body": row.get::<_, String>(2)?, "pinned": row.get::<_, bool>(3)?, "created_at": row.get::<_, String>(4)?}))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        rows
    };

    let reservations: Vec<serde_json::Value> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT cr.id, cl.name, cr.quantity, cr.reserved_date, cr.status, cr.notes
             FROM client_reservations cr JOIN clients cl ON cr.client_id = cl.id WHERE cr.product_id = {} ORDER BY cr.reserved_date", product_id)).map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt.query_map([], |row| Ok(serde_json::json!({"id": row.get::<_, i64>(0)?, "client": row.get::<_, String>(1)?, "qty": row.get::<_, f64>(2)?, "date": row.get::<_, String>(3)?, "status": row.get::<_, String>(4)?, "notes": row.get::<_, Option<String>>(5)?}))).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
        rows
    };

    Ok(serde_json::json!({
        "product": product, "attributes": attrs, "history": history, "cost_data": cost_data, "notes": notes, "reservations": reservations
    }))
}

#[derive(Serialize, Deserialize)]
struct AppPreferences {
    last_db_path: Option<String>,
}

fn prefs_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|e| format!("Cannot find HOME: {}", e))?;
    Ok(std::path::PathBuf::from(home).join(".dbreader-state.json"))
}

#[tauri::command]
fn save_preferences(last_db_path: Option<String>) -> Result<(), String> {
    let prefs = AppPreferences { last_db_path };
    let json = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(prefs_path()?, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_preferences() -> Result<AppPreferences, String> {
    let path = prefs_path()?;
    if !path.exists() {
        return Ok(AppPreferences { last_db_path: None });
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DbState {
            conn: Mutex::new(None),
            path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            open_database,
            create_new_database,
            get_schema,
            get_tables,
            get_table_columns,
            execute_query,
            get_table_data,
            get_database_path,
            close_database,
            migrate_schema,
            update_batch_status,
            delete_inventory_log,
            update_inventory_log_notes,
            update_product,
            upsert_product_attribute,
            update_unit_conversion,
            upsert_category,
            delete_category,
            get_category_templates,
            upsert_category_template,
            delete_category_template,
            upsert_product_note,
            delete_product_note,
            upsert_client,
            delete_client,
            upsert_reservation,
            delete_reservation,
            upsert_calendar_event,
            toggle_calendar_event,
            delete_calendar_event,
            upsert_notification,
            delete_notification,
            get_product_report_data,
            save_preferences,
            load_preferences,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
