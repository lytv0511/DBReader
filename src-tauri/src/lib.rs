use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

struct DbState {
    inner: Mutex<InnerState>,
}

struct InnerState {
    conn: Option<Connection>,
    path: Option<String>,
}

struct PrintState(Mutex<Option<String>>);

struct EmailState(Mutex<String>);

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

fn with_conn<F, T>(state: &State<DbState>, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    let conn = inner.conn.as_ref().ok_or_else(|| "No database connected".to_string())?;
    f(conn)
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

CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    sub_name VARCHAR(100)
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
    provider_id INTEGER REFERENCES providers(id),
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

INSERT INTO providers (name, sub_name) VALUES ('Main Cellar', 'Rack A, Shelf 1');
INSERT INTO providers (name, sub_name) VALUES ('Main Cellar', 'Rack A, Shelf 2');
INSERT INTO providers (name, sub_name) VALUES ('Main Cellar', 'Rack B, Shelf 1');
INSERT INTO providers (name, sub_name) VALUES ('Cold Storage', 'Section 1');
INSERT INTO providers (name, sub_name) VALUES ('Warehouse', 'Ground Level');

INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES
(1, 'Château Margaux 2015', 'WINE-R-001', 'bottle', 6),
(1, 'Penfolds Grange 2018', 'WINE-R-002', 'bottle', 4),
(1, 'Opus One 2019', 'WINE-R-003', 'bottle', 6),
(2, 'Cloudy Bay Sauvignon Blanc 2022', 'WINE-W-001', 'bottle', 12),
(2, 'Chablis Premier Cru 2020', 'WINE-W-002', 'bottle', 8),
(3, 'Whispering Angel 2023', 'WINE-RS-001', 'bottle', 10),
(4, 'Dom Pérignon 2013', 'WINE-SP-001', 'bottle', 4),
(4, 'Moët & Chandon Impérial', 'WINE-SP-002', 'bottle', 8),
(5, 'Taylor''s 20 Year Tawny Port', 'WINE-F-001', 'bottle', 6),
(6, 'Hendrick''s Gin', 'SPIR-001', 'bottle', 4),
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

INSERT INTO inventory_logs (batch_id, provider_id, quantity_change, transaction_type, notes, created_at) VALUES
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

fn safe_quote(id: &str) -> String {
    format!("\"{}\"", id.replace('"', "\"\""))
}

fn is_valid_table_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || c == '_')
}

fn get_tables_internal(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| format!("Failed to query tables: {}", e))?;
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Failed to read tables: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read tables: {}", e))?;
    Ok(tables)
}

fn get_columns_internal(conn: &Connection, table: &str) -> Result<Vec<ColumnInfo>, String> {
    let quoted = safe_quote(table);
    let pragma = format!("PRAGMA table_info({})", quoted);
    let mut stmt = conn
        .prepare(&pragma)
        .map_err(|e| format!("Failed to query columns: {}", e))?;
    let columns = stmt
        .query_map([], |row| {
            let not_null_i32: i32 = row.get(3)?;
            let pk_i32: i32 = row.get(5)?;
            let default_value: Option<String> = match row.get::<_, Option<String>>(4) {
                Ok(v) => v,
                Err(_) => None,
            };
            Ok(ColumnInfo {
                name: row.get(1)?,
                data_type: row.get(2)?,
                not_null: not_null_i32 != 0,
                default_value,
                primary_key: pk_i32 != 0,
            })
        })
        .map_err(|e| format!("Failed to read columns: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read columns: {}", e))?;
    Ok(columns)
}

#[tauri::command]
fn open_database(path: String, state: State<DbState>, app: tauri::AppHandle) -> Result<TableInfo, String> {
    let conn = Connection::open(&path).map_err(|e| format!("Failed to open database: {}", e))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
    let tables = get_tables_internal(&conn)?;
    let mut columns = Vec::new();
    if let Some(first) = tables.first() {
        columns = get_columns_internal(&conn, first)?;
    }
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    *inner = InnerState {
        conn: Some(conn),
        path: Some(path),
    };
    let handle = app.clone();
    std::thread::spawn(move || email_check(&handle, false));
    Ok(TableInfo {
        name: tables.first().cloned().unwrap_or_default(),
        columns,
    })
}

#[tauri::command]
fn create_new_database(path: String, state: State<DbState>, app: tauri::AppHandle) -> Result<TableInfo, String> {
    if std::path::Path::new(&path).exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to replace existing database: {}", e))?;
    }
    let conn = Connection::open(&path).map_err(|e| format!("Failed to create database: {}", e))?;
    conn.execute_batch("BEGIN;")
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    if let Err(e) = conn.execute_batch(INVENTORY_SCHEMA) {
        conn.execute_batch("ROLLBACK;").ok();
        return Err(format!("Failed to create schema: {}", e));
    }
    conn.execute_batch("COMMIT;")
        .map_err(|e| format!("Failed to commit transaction: {}", e))?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
    let tables = get_tables_internal(&conn)?;
    let mut columns = Vec::new();
    if let Some(first) = tables.first() {
        columns = get_columns_internal(&conn, first)?;
    }
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    *inner = InnerState {
        conn: Some(conn),
        path: Some(path),
    };
    let handle = app.clone();
    std::thread::spawn(move || email_check(&handle, false));
    Ok(TableInfo {
        name: tables.first().cloned().unwrap_or_default(),
        columns,
    })
}

#[tauri::command]
fn get_schema(state: State<DbState>) -> Result<TableInfo, String> {
    with_conn(&state, |conn| {
        let tables = get_tables_internal(conn)?;
        let mut columns = Vec::new();
        if let Some(first) = tables.first() {
            columns = get_columns_internal(conn, first)?;
        }
        Ok(TableInfo {
            name: tables.first().cloned().unwrap_or_default(),
            columns,
        })
    })
}

#[tauri::command]
fn get_tables(state: State<DbState>) -> Result<Vec<String>, String> {
    with_conn(&state, |conn| get_tables_internal(conn))
}

#[tauri::command]
fn get_table_columns(table: String, state: State<DbState>) -> Result<Vec<ColumnInfo>, String> {
    with_conn(&state, |conn| get_columns_internal(conn, &table))
}

#[tauri::command]
fn execute_query(sql: String, state: State<DbState>) -> Result<QueryResult, String> {
    with_conn(&state, |conn| {
        let stripped = strip_sql_comments(&sql);
        let trimmed = stripped.trim().to_uppercase();
        let is_query = trimmed.starts_with("SELECT")
            || trimmed.starts_with("PRAGMA")
            || trimmed.starts_with("EXPLAIN")
            || trimmed.starts_with("WITH");

        if is_query {
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("SQL error: {}", e))?;
            let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let num_cols = stmt.column_count();
            let mut rows = Vec::new();
            let rows_result = stmt
                .query_map([], |row| {
                    let mut values = Vec::new();
                    for i in 0..num_cols {
                        let val: serde_json::Value = if let Ok(n) = row.get::<_, i64>(i) {
                            serde_json::Value::Number(n.into())
                        } else if let Ok(f) = row.get::<_, f64>(i) {
                            serde_json::Value::Number(
                                serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
                            )
                        } else if let Ok(Some(s)) = row.get::<_, Option<String>>(i) {
                            serde_json::Value::String(s)
                        } else {
                            serde_json::Value::Null
                        };
                        values.push(val);
                    }
                    Ok(values)
                })
                .map_err(|e| format!("SQL execution error: {}", e))?;
            for row in rows_result {
                let values = row.map_err(|e| format!("Row read error: {}", e))?;
                rows.push(values);
            }
            Ok(QueryResult { columns: col_names, rows, rows_affected: None })
        } else {
            let rows_affected = conn.execute(&sql, [])
                .map_err(|e| format!("SQL execution error: {}", e))?;
            Ok(QueryResult { columns: vec![], rows: vec![], rows_affected: Some(rows_affected as u64) })
        }
    })
}

fn strip_sql_comments(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '-' && chars[i + 1] == '-' {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if i + 1 < chars.len() && chars[i] == '/' && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }
    result
}

#[tauri::command]
fn get_table_data(table: String, limit: Option<u32>, state: State<DbState>) -> Result<QueryResult, String> {
    with_conn(&state, |conn| {
        let lim = limit.unwrap_or(100);
        if !is_valid_table_name(&table) {
            return Err("Invalid table name".to_string());
        }
        let quoted = safe_quote(&table);
        let sql = format!("SELECT * FROM {} LIMIT ?", quoted);
        let mut stmt = conn.prepare(&sql)
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
        let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let num_cols = stmt.column_count();
        let mut rows = Vec::new();
        let rows_result = stmt
            .query_map(rusqlite::params![lim], |row| {
                let mut values = Vec::new();
                for i in 0..num_cols {
                    let val: serde_json::Value = if let Ok(n) = row.get::<_, i64>(i) {
                        serde_json::Value::Number(n.into())
                    } else if let Ok(f) = row.get::<_, f64>(i) {
                        serde_json::Value::Number(
                            serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
                        )
                    } else if let Ok(Some(s)) = row.get::<_, Option<String>>(i) {
                        serde_json::Value::String(s)
                    } else {
                        serde_json::Value::Null
                    };
                    values.push(val);
                }
                Ok(values)
            })
            .map_err(|e| format!("Query error: {}", e))?;
        for row in rows_result {
            let values = row.map_err(|e| format!("Row read error: {}", e))?;
            rows.push(values);
        }
        Ok(QueryResult { columns: col_names, rows, rows_affected: None })
    })
}

#[tauri::command]
fn get_database_path(state: State<DbState>) -> Result<Option<String>, String> {
    let inner = state.inner.lock().map_err(|e| e.to_string())?;
    Ok(inner.path.clone())
}

#[tauri::command]
fn close_database(state: State<DbState>) -> Result<(), String> {
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    *inner = InnerState { conn: None, path: None };
    Ok(())
}

#[tauri::command]
fn migrate_schema(state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        let locations_exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='locations'",
                [],
                |r| r.get(0),
            )
            .map(|c: i64| c > 0)
            .unwrap_or(false);
        if locations_exists {
            conn.execute_batch("ALTER TABLE locations RENAME TO providers;").ok();
        }
        let has_column = |table: &str, column: &str| -> bool {
            conn.query_row(
                &format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1", table),
                rusqlite::params![column],
                |r| r.get(0),
            )
            .map(|c: i64| c > 0)
            .unwrap_or(false)
        };
        if has_column("providers", "sub_location") {
            conn.execute_batch("ALTER TABLE providers RENAME COLUMN sub_location TO sub_name;").ok();
        }
        if has_column("inventory_logs", "location_id") {
            conn.execute_batch("ALTER TABLE inventory_logs RENAME COLUMN location_id TO provider_id;").ok();
        }
        let steps: [&str; 19] = [
            "ALTER TABLE batches ADD COLUMN status VARCHAR(30) DEFAULT 'in_inventory';",
            "CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);",
            "ALTER TABLE categories ADD COLUMN description TEXT;",
            "ALTER TABLE categories ADD COLUMN icon VARCHAR(10) DEFAULT '📋';",
            "ALTER TABLE categories ADD COLUMN color VARCHAR(20) DEFAULT '#5b6abf';",
            "CREATE TABLE IF NOT EXISTS category_attribute_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, attr_key VARCHAR(100) NOT NULL, attr_type VARCHAR(20) DEFAULT 'string', is_required INTEGER DEFAULT 0, display_order INTEGER DEFAULT 0, UNIQUE(category_id, attr_key));",
            "CREATE TABLE IF NOT EXISTS product_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, title VARCHAR(255), body TEXT NOT NULL, is_pinned INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
            "CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(50), company VARCHAR(255), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
            "CREATE TABLE IF NOT EXISTS client_reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, quantity NUMERIC(10, 2) NOT NULL DEFAULT 1, reserved_date DATE NOT NULL, fulfilled_date DATE, status VARCHAR(30) DEFAULT 'reserved' CHECK (status IN ('reserved', 'partial', 'fulfilled', 'cancelled')), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
            "CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('purchase', 'shipping', 'delivery', 'tasting', 'reservation', 'custom')), event_date DATE NOT NULL, end_date DATE, quantity NUMERIC(10, 2), notes TEXT, is_completed INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
            "CREATE TABLE IF NOT EXISTS product_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('low_stock', 'expiry', 'custom', 'reorder', 'reservation')), message TEXT NOT NULL, threshold_value NUMERIC(10, 2), is_active INTEGER DEFAULT 1, last_triggered TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);",
            "CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);",
            "CREATE INDEX IF NOT EXISTS idx_templates_category ON category_attribute_templates(category_id);",
            "CREATE INDEX IF NOT EXISTS idx_notes_product ON product_notes(product_id);",
            "CREATE INDEX IF NOT EXISTS idx_reservations_client ON client_reservations(client_id);",
            "CREATE INDEX IF NOT EXISTS idx_reservations_product ON client_reservations(product_id);",
            "CREATE INDEX IF NOT EXISTS idx_calendar_product ON calendar_events(product_id);",
            "CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(event_date);",
            "CREATE INDEX IF NOT EXISTS idx_notifications_product ON product_notifications(product_id);",
        ];
        let mut any_failed = false;
        let mut last_error = String::new();
        for step in &steps {
            if let Err(e) = conn.execute_batch(step) {
                let msg = e.to_string();
                if !msg.contains("duplicate column") && !msg.contains("already exists") {
                    any_failed = true;
                    last_error = msg;
                }
            }
        }
        if any_failed {
            Err(format!("Migration error: {}", last_error))
        } else {
            Ok(())
        }
    })
}

#[tauri::command]
fn update_batch_status(batch_id: i64, status: String, state: State<DbState>) -> Result<(), String> {
    let valid = ["ordered", "shipping", "arrived", "in_inventory", "used", "reserved"];
    if !valid.contains(&status.as_str()) {
        return Err(format!("Invalid status: {}. Must be one of: {}", status, valid.join(", ")));
    }
    with_conn(&state, |conn| {
        conn.execute("UPDATE batches SET status = ?1 WHERE id = ?2", rusqlite::params![status, batch_id])
            .map_err(|e| format!("Failed to update batch status: {}", e))?;
        Ok(())
    })
}

#[tauri::command]
fn delete_inventory_log(log_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM inventory_logs WHERE id = ?1", rusqlite::params![log_id])
            .map_err(|e| format!("Failed to delete inventory log: {}", e))?;
        Ok(())
    })
}

#[tauri::command]
fn update_inventory_log_notes(log_id: i64, notes: Option<String>, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("UPDATE inventory_logs SET notes = ?1 WHERE id = ?2", rusqlite::params![notes, log_id])
            .map_err(|e| format!("Failed to update log notes: {}", e))?;
        Ok(())
    })
}

#[tauri::command]
fn update_product(product_id: i64, name: String, sku: Option<String>, category_id: Option<i64>, base_unit_name: String, reorder_threshold: f64, state: State<DbState>) -> Result<(), String> {
    if !reorder_threshold.is_finite() {
        return Err("reorder_threshold must be a finite number".to_string());
    }
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE products SET name = ?1, sku = ?2, category_id = ?3, base_unit_name = ?4, reorder_threshold = ?5 WHERE id = ?6",
            rusqlite::params![name, sku, category_id, base_unit_name, reorder_threshold, product_id],
        ).map_err(|e| format!("Failed to update product: {}", e))?;
        Ok(())
    })
}

#[tauri::command]
fn upsert_product_attribute(product_id: i64, attr_key: String, attr_value: String, data_type: String, state: State<DbState>) -> Result<i64, String> {
    with_conn(&state, |conn| {
        let existing: Option<i64> = conn.query_row(
            "SELECT id FROM product_attributes WHERE product_id = ?1 AND attr_key = ?2",
            rusqlite::params![product_id, attr_key],
            |row| row.get(0),
        ).ok();
        match existing {
            Some(id) => {
                conn.execute(
                    "UPDATE product_attributes SET attr_value = ?1, data_type = ?2 WHERE id = ?3",
                    rusqlite::params![attr_value, data_type, id],
                ).map_err(|e| format!("Failed to update attribute: {}", e))?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO product_attributes (product_id, attr_key, attr_value, data_type) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![product_id, attr_key, attr_value, data_type],
                ).map_err(|e| format!("Failed to insert attribute: {}", e))?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn update_unit_conversion(conversion_id: i64, unit_name: String, conversion_factor: f64, state: State<DbState>) -> Result<(), String> {
    if !conversion_factor.is_finite() {
        return Err("conversion_factor must be a finite number".to_string());
    }
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE unit_conversions SET unit_name = ?1, conversion_factor = ?2 WHERE id = ?3",
            rusqlite::params![unit_name, conversion_factor, conversion_id],
        ).map_err(|e| format!("Failed to update unit conversion: {}", e))?;
        Ok(())
    })
}

#[tauri::command]
fn upsert_category(name: String, description: Option<String>, icon: Option<String>, color: Option<String>, state: State<DbState>) -> Result<i64, String> {
    with_conn(&state, |conn| {
        let ico = icon.unwrap_or_else(|| "📋".to_string());
        let col = color.unwrap_or_else(|| "#5b6abf".to_string());
        let existing: Option<i64> = conn.query_row(
            "SELECT id FROM categories WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        ).ok();
        match existing {
            Some(id) => {
                conn.execute(
                    "UPDATE categories SET description = ?1, icon = ?2, color = ?3 WHERE id = ?4",
                    rusqlite::params![description, ico, col, id],
                ).map_err(|e| format!("Failed to update category: {}", e))?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO categories (name, description, icon, color) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![name, description, ico, col],
                ).map_err(|e| format!("Failed to create category: {}", e))?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn delete_category(category_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute_batch("BEGIN;")
            .map_err(|e| format!("Failed to start transaction: {}", e))?;
        if let Err(e) = conn.execute("DELETE FROM category_attribute_templates WHERE category_id = ?1", rusqlite::params![category_id]) {
            conn.execute_batch("ROLLBACK;").ok();
            return Err(format!("Failed to delete category templates: {}", e));
        }
        if let Err(e) = conn.execute("UPDATE products SET category_id = NULL WHERE category_id = ?1", rusqlite::params![category_id]) {
            conn.execute_batch("ROLLBACK;").ok();
            return Err(format!("Failed to unassign products: {}", e));
        }
        if let Err(e) = conn.execute("DELETE FROM categories WHERE id = ?1", rusqlite::params![category_id]) {
            conn.execute_batch("ROLLBACK;").ok();
            return Err(format!("Failed to delete category: {}", e));
        }
        conn.execute_batch("COMMIT;").map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn get_category_templates(category_id: i64, state: State<DbState>) -> Result<Vec<serde_json::Value>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT id, attr_key, attr_type, is_required, display_order FROM category_attribute_templates WHERE category_id = ?1 ORDER BY display_order"
        ).map_err(|e| format!("Failed to query templates: {}", e))?;
        let rows = stmt.query_map(rusqlite::params![category_id], |row| {
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
            let r = row.map_err(|e| format!("Template row error: {}", e))?;
            result.push(r);
        }
        Ok(result)
    })
}

#[tauri::command]
fn upsert_category_template(category_id: i64, attr_key: String, attr_type: String, is_required: bool, display_order: i64, state: State<DbState>) -> Result<i64, String> {
    with_conn(&state, |conn| {
        let existing: Option<i64> = conn.query_row(
            "SELECT id FROM category_attribute_templates WHERE category_id = ?1 AND attr_key = ?2",
            rusqlite::params![category_id, attr_key],
            |row| row.get(0),
        ).ok();
        match existing {
            Some(id) => {
                conn.execute(
                    "UPDATE category_attribute_templates SET attr_type = ?1, is_required = ?2, display_order = ?3 WHERE id = ?4",
                    rusqlite::params![attr_type, is_required, display_order, id],
                ).map_err(|e| format!("Failed to update template: {}", e))?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO category_attribute_templates (category_id, attr_key, attr_type, is_required, display_order) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![category_id, attr_key, attr_type, is_required, display_order],
                ).map_err(|e| format!("Failed to create template: {}", e))?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn delete_category_template(template_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM category_attribute_templates WHERE id = ?1", rusqlite::params![template_id])
            .map_err(|e| format!("Failed to delete template: {}", e))?;
        Ok(())
    })
}

// === Product Notes ===
#[tauri::command]
fn upsert_product_note(product_id: i64, title: Option<String>, body: String, is_pinned: bool, note_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    with_conn(&state, |conn| {
        match note_id {
            Some(id) => {
                conn.execute(
                    "UPDATE product_notes SET title = ?1, body = ?2, is_pinned = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
                    rusqlite::params![title, body, is_pinned, id],
                ).map_err(|e| e.to_string())?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO product_notes (product_id, title, body, is_pinned) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![product_id, title, body, is_pinned],
                ).map_err(|e| e.to_string())?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn delete_product_note(note_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM product_notes WHERE id = ?1", rusqlite::params![note_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// === Clients ===
#[tauri::command]
fn upsert_client(name: String, email: Option<String>, phone: Option<String>, company: Option<String>, notes: Option<String>, client_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    with_conn(&state, |conn| {
        match client_id {
            Some(id) => {
                conn.execute(
                    "UPDATE clients SET name = ?1, email = ?2, phone = ?3, company = ?4, notes = ?5 WHERE id = ?6",
                    rusqlite::params![name, email, phone, company, notes, id],
                ).map_err(|e| e.to_string())?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO clients (name, email, phone, company, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![name, email, phone, company, notes],
                ).map_err(|e| e.to_string())?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn delete_client(client_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute_batch("BEGIN;").map_err(|e| e.to_string())?;
        if let Err(e) = conn.execute("DELETE FROM client_reservations WHERE client_id = ?1", rusqlite::params![client_id]) {
            conn.execute_batch("ROLLBACK;").ok();
            return Err(format!("Failed to delete client reservations: {}", e));
        }
        if let Err(e) = conn.execute("DELETE FROM clients WHERE id = ?1", rusqlite::params![client_id]) {
            conn.execute_batch("ROLLBACK;").ok();
            return Err(format!("Failed to delete client: {}", e));
        }
        conn.execute_batch("COMMIT;").map_err(|e| e.to_string())?;
        Ok(())
    })
}

// === Reservations ===
#[tauri::command]
fn upsert_reservation(client_id: i64, product_id: i64, quantity: f64, reserved_date: String, status: Option<String>, notes: Option<String>, fulfilled_date: Option<String>, reservation_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    if !quantity.is_finite() {
        return Err("quantity must be a finite number".to_string());
    }
    with_conn(&state, |conn| {
        let status_val = status.unwrap_or_else(|| "reserved".to_string());
        match reservation_id {
            Some(id) => {
                conn.execute(
                    "UPDATE client_reservations SET client_id = ?1, product_id = ?2, quantity = ?3, reserved_date = ?4, status = ?5, notes = ?6, fulfilled_date = ?7 WHERE id = ?8",
                    rusqlite::params![client_id, product_id, quantity, reserved_date, status_val, notes, fulfilled_date, id],
                ).map_err(|e| e.to_string())?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO client_reservations (client_id, product_id, quantity, reserved_date, status, notes, fulfilled_date) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![client_id, product_id, quantity, reserved_date, status_val, notes, fulfilled_date],
                ).map_err(|e| e.to_string())?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn delete_reservation(reservation_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM client_reservations WHERE id = ?1", rusqlite::params![reservation_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// === Calendar Events ===
#[tauri::command]
fn upsert_calendar_event(product_id: Option<i64>, title: String, event_type: String, event_date: String, end_date: Option<String>, quantity: Option<f64>, notes: Option<String>, event_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    with_conn(&state, |conn| {
        match event_id {
            Some(id) => {
                conn.execute(
                    "UPDATE calendar_events SET product_id = ?1, title = ?2, event_type = ?3, event_date = ?4, end_date = ?5, quantity = ?6, notes = ?7 WHERE id = ?8",
                    rusqlite::params![product_id, title, event_type, event_date, end_date, quantity, notes, id],
                ).map_err(|e| e.to_string())?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO calendar_events (product_id, title, event_type, event_date, end_date, quantity, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![product_id, title, event_type, event_date, end_date, quantity, notes],
                ).map_err(|e| e.to_string())?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn toggle_calendar_event(event_id: i64, is_completed: bool, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("UPDATE calendar_events SET is_completed = ?1 WHERE id = ?2", rusqlite::params![is_completed, event_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
fn delete_calendar_event(event_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM calendar_events WHERE id = ?1", rusqlite::params![event_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// === Notifications ===
#[tauri::command]
fn upsert_notification(product_id: i64, notification_type: String, message: String, threshold_value: Option<f64>, is_active: bool, notification_id: Option<i64>, state: State<DbState>) -> Result<i64, String> {
    with_conn(&state, |conn| {
        match notification_id {
            Some(id) => {
                conn.execute(
                    "UPDATE product_notifications SET notification_type = ?1, message = ?2, threshold_value = ?3, is_active = ?4 WHERE id = ?5",
                    rusqlite::params![notification_type, message, threshold_value, is_active, id],
                ).map_err(|e| e.to_string())?;
                Ok(id)
            }
            None => {
                conn.execute(
                    "INSERT INTO product_notifications (product_id, notification_type, message, threshold_value, is_active) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![product_id, notification_type, message, threshold_value, is_active],
                ).map_err(|e| e.to_string())?;
                Ok(conn.last_insert_rowid())
            }
        }
    })
}

#[tauri::command]
fn delete_notification(notification_id: i64, state: State<DbState>) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM product_notifications WHERE id = ?1", rusqlite::params![notification_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// === Product Report Data ===
#[tauri::command]
fn get_product_report_data(product_id: i64, state: State<DbState>) -> Result<serde_json::Value, String> {
    with_conn(&state, |conn| {
        let product: serde_json::Value = conn.query_row(
            "SELECT p.id, p.name, p.sku, COALESCE(c.name, 'Uncategorized'), COALESCE(c.icon, '📋'), COALESCE(c.color, '#5b6abf')
             FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?1",
            rusqlite::params![product_id],
            |row| Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?, "name": row.get::<_, String>(1)?, "sku": row.get::<_, Option<String>>(2)?,
                "category": row.get::<_, String>(3)?, "icon": row.get::<_, String>(4)?, "color": row.get::<_, String>(5)?
            }))
        ).map_err(|e| e.to_string())?;

        let attrs: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare("SELECT attr_key, attr_value, data_type FROM product_attributes WHERE product_id = ?1 ORDER BY attr_key").map_err(|e| e.to_string())?;
            let rows: Vec<_> = stmt.query_map(rusqlite::params![product_id], |row| Ok(serde_json::json!({"key": row.get::<_, String>(0)?, "value": row.get::<_, String>(1)?, "type": row.get::<_, String>(2)?}))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            rows
        };

        let history: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare(
                "SELECT il.transaction_type, SUM(il.quantity_change) as net_qty, strftime('%Y-%m', il.created_at) as month
                 FROM inventory_logs il JOIN batches b ON il.batch_id = b.id WHERE b.product_id = ?1 GROUP BY il.transaction_type, month ORDER BY month"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<_> = stmt.query_map(rusqlite::params![product_id], |row| Ok(serde_json::json!({"type": row.get::<_, String>(0)?, "qty": row.get::<_, f64>(1)?, "month": row.get::<_, String>(2)?}))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            rows
        };

        let cost_data: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare(
                "SELECT b.purchase_date, b.unit_cost_price, SUM(COALESCE(il2.quantity_change, 0)) as total_purchased_qty
                 FROM batches b LEFT JOIN inventory_logs il2 ON il2.batch_id = b.id AND il2.transaction_type = 'PURCHASE'
                 WHERE b.product_id = ?1 GROUP BY b.id ORDER BY b.purchase_date"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<_> = stmt.query_map(rusqlite::params![product_id], |row| Ok(serde_json::json!({"date": row.get::<_, String>(0)?, "cost": row.get::<_, f64>(1)?, "total_purchased_qty": row.get::<_, f64>(2)?}))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            rows
        };

        let notes: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare("SELECT id, title, body, is_pinned, created_at FROM product_notes WHERE product_id = ?1 ORDER BY is_pinned DESC, created_at DESC").map_err(|e| e.to_string())?;
            let rows: Vec<_> = stmt.query_map(rusqlite::params![product_id], |row| Ok(serde_json::json!({"id": row.get::<_, i64>(0)?, "title": row.get::<_, Option<String>>(1)?, "body": row.get::<_, String>(2)?, "pinned": row.get::<_, bool>(3)?, "created_at": row.get::<_, String>(4)?}))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            rows
        };

        let reservations: Vec<serde_json::Value> = {
            let mut stmt = conn.prepare(
                "SELECT cr.id, cl.name, cr.quantity, cr.reserved_date, cr.status, cr.notes
                 FROM client_reservations cr JOIN clients cl ON cr.client_id = cl.id WHERE cr.product_id = ?1 ORDER BY cr.reserved_date"
            ).map_err(|e| e.to_string())?;
            let rows: Vec<_> = stmt.query_map(rusqlite::params![product_id], |row| Ok(serde_json::json!({"id": row.get::<_, i64>(0)?, "client": row.get::<_, String>(1)?, "qty": row.get::<_, f64>(2)?, "date": row.get::<_, String>(3)?, "status": row.get::<_, String>(4)?, "notes": row.get::<_, Option<String>>(5)?}))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
            rows
        };

        Ok(serde_json::json!({
            "product": product, "attributes": attrs, "history": history, "cost_data": cost_data, "notes": notes, "reservations": reservations
        }))
    })
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EmailSlot {
    enabled: bool,
    time: String,
    #[serde(default)]
    last_fired: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppPreferences {
    last_db_path: Option<String>,
    theme: Option<String>,
    language: Option<String>,
    open_on_startup: Option<bool>,
    default_query_limit: Option<i64>,
    inventory_tab_order: Option<Vec<String>>,
    enabled_tabs: Option<Vec<String>>,
    use_default_taskbar: Option<bool>,
    currency_symbol: Option<String>,
    email_alerts_enabled: Option<bool>,
    email_smtp_host: Option<String>,
    email_smtp_port: Option<i64>,
    email_smtp_security: Option<String>,
    email_sender: Option<String>,
    email_username: Option<String>,
    email_password: Option<String>,
    email_recipients: Option<String>,
    email_slots: Option<Vec<EmailSlot>>,
    desktop_notifications: Option<bool>,
    launch_at_login: Option<bool>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        AppPreferences {
            last_db_path: None,
            theme: None,
            language: None,
            open_on_startup: Some(true),
            default_query_limit: Some(100),
            inventory_tab_order: None,
            enabled_tabs: None,
            use_default_taskbar: Some(true),
            currency_symbol: None,
            email_alerts_enabled: Some(false),
            email_smtp_host: Some("smtp.gmail.com".into()),
            email_smtp_port: Some(587),
            email_smtp_security: Some("starttls".into()),
            email_sender: Some("dbreaderauto@gmail.com".into()),
            email_username: Some("dbreaderauto@gmail.com".into()),
            email_password: Some("kimlkjrdxfawgmdm".into()),
            email_recipients: None,
            email_slots: Some(vec![
                EmailSlot { enabled: true, time: "08:00".into(), last_fired: None },
                EmailSlot { enabled: true, time: "13:00".into(), last_fired: None },
                EmailSlot { enabled: true, time: "18:00".into(), last_fired: None },
            ]),
            desktop_notifications: Some(true),
            launch_at_login: Some(false),
        }
    }
}

fn prefs_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot find HOME/USERPROFILE".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".dbreader-state.json"))
}

#[tauri::command]
fn save_preferences(prefs: AppPreferences) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&prefs).map_err(|e| e.to_string())?;
    std::fs::write(prefs_path()?, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_preferences() -> Result<AppPreferences, String> {
    load_prefs_internal()
}

fn load_prefs_internal() -> Result<AppPreferences, String> {
    let path = prefs_path()?;
    if !path.exists() {
        return Ok(AppPreferences::default());
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

/* ==================== Email stock alerts ==================== */

struct LowStockItem {
    name: String,
    sku: Option<String>,
    stock: f64,
    threshold: f64,
}

fn low_stock_items(conn: &Connection) -> Result<Vec<LowStockItem>, String> {
    let sql = "
        SELECT p.name, p.sku,
               COALESCE(SUM(il.quantity_change), 0) AS stock,
               p.reorder_threshold
        FROM products p
        LEFT JOIN batches b ON b.product_id = p.id
        LEFT JOIN inventory_logs il ON il.batch_id = b.id
        GROUP BY p.id, p.name, p.sku, p.reorder_threshold
        HAVING (stock <= p.reorder_threshold AND p.reorder_threshold > 0) OR stock <= 0
        ORDER BY stock ASC, p.name ASC
    ";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LowStockItem {
                name: row.get(0)?,
                sku: row.get(1)?,
                stock: row.get(2)?,
                threshold: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for r in rows {
        items.push(r.map_err(|e| e.to_string())?);
    }
    Ok(items)
}

fn fmt_escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn build_digest_html(items: &[LowStockItem]) -> String {
    let rows: String = items
        .iter()
        .map(|it| {
            let name = fmt_escape_html(&it.name);
            let sku = it.sku.as_deref().unwrap_or("-");
            format!(
                "<tr><td style=\"padding:6px 10px;border-bottom:1px solid #ddd;\"><b>{}</b></td><td style=\"padding:6px 10px;border-bottom:1px solid #ddd;\">{}</td><td style=\"padding:6px 10px;border-bottom:1px solid #ddd;text-align:center;\">{}</td><td style=\"padding:6px 10px;border-bottom:1px solid #ddd;text-align:center;\">{}</td></tr>",
                name,
                fmt_escape_html(sku),
                it.stock,
                it.threshold
            )
        })
        .collect();
    format!(
        "<html><body style=\"font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a1a;\">\
         <h2 style=\"margin-bottom:4px;\">Low stock alert</h2>\
         <p style=\"color:#555;\">{} item(s) are low on stock or out of stock.</p>\
         <table style=\"border-collapse:collapse;width:100%;max-width:600px;\">\
         <tr style=\"background:#f3f4f6;\"><th style=\"padding:6px 10px;text-align:left;\">Product</th><th style=\"padding:6px 10px;text-align:left;\">SKU</th><th style=\"padding:6px 10px;\">Stock</th><th style=\"padding:6px 10px;\">Reorder at</th></tr>\
         {}</table>\
         <p style=\"color:#999;font-size:12px;margin-top:16px;\">Sent automatically by DBReader.</p></body></html>",
        items.len(),
        rows
    )
}

fn slot_time_secs(time: &str) -> i64 {
    let parts: Vec<&str> = time.split(':').collect();
    let h: i64 = parts.first().and_then(|x| x.parse().ok()).unwrap_or(0);
    let m: i64 = parts.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
    h.clamp(0, 23) * 3600 + m.clamp(0, 59) * 60
}

fn slot_due_index(prefs: &AppPreferences) -> Option<usize> {
    use chrono::Timelike;
    let now = chrono::Local::now();
    let now_secs = now.hour() as i64 * 3600 + now.minute() as i64 * 60;
    let today = now.format("%Y-%m-%d").to_string();
    let slots = prefs.email_slots.clone().unwrap_or_default();
    for (i, slot) in slots.iter().enumerate() {
        if !slot.enabled {
            continue;
        }
        let s = slot_time_secs(&slot.time);
        if now_secs >= s && now_secs - s <= 15 * 60 && slot.last_fired.as_deref() != Some(today.as_str()) {
            return Some(i);
        }
    }
    None
}

fn mark_slot_fired(idx: usize) {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let Ok(mut prefs) = load_prefs_internal() else { return };
    if let Some(slots) = prefs.email_slots.as_mut() {
        if let Some(slot) = slots.get_mut(idx) {
            slot.last_fired = Some(today);
        }
    }
    let _ = save_preferences(prefs);
}

fn send_alert_email(prefs: &AppPreferences, subject: String, html: String) -> Result<(), String> {
    use lettre::message::{header::ContentType, Mailbox, Message};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::transport::smtp::client::{Tls, TlsParameters};
    use lettre::{SmtpTransport, Transport};

    let host = "smtp.gmail.com";
    let port = 587u16;
    let security = "starttls";
    let username = "dbreaderauto@gmail.com";
    let password = "kimlkjrdxfawgmdm";
    let sender = "dbreaderauto@gmail.com";
    let recipients: String = prefs
        .email_recipients
        .clone()
        .ok_or_else(|| "Recipients are not set".to_string())?;

    let sender: Mailbox = sender
        .parse()
        .map_err(|e| format!("Invalid sender address: {}", e))?;

    let mut msg_builder = Message::builder()
        .from(sender)
        .subject(subject)
        .header(ContentType::TEXT_HTML);

    let mut has_recipient = false;
    for r in recipients.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let mb: Mailbox = r.parse().map_err(|e| format!("Invalid recipient address '{}': {}", r, e))?;
        msg_builder = msg_builder.to(mb);
        has_recipient = true;
    }
    if !has_recipient {
        return Err("No recipients configured".into());
    }

    let email = msg_builder.body(html).map_err(|e| e.to_string())?;

    let tls = match security {
        "ssl" => Tls::Wrapper(
            TlsParameters::new(host.to_string()).map_err(|e| format!("TLS error: {}", e))?,
        ),
        "none" => Tls::None,
        _ => Tls::Required(
            TlsParameters::new(host.to_string()).map_err(|e| format!("TLS error: {}", e))?,
        ),
    };

    let mailer = SmtpTransport::builder_dangerous(host)
        .port(port)
        .credentials(Credentials::new(username.to_string(), password.to_string()))
        .tls(tls)
        .build();

    mailer
        .send(&email)
        .map_err(|e| format!("SMTP send failed: {}", e))?;
    Ok(())
}

fn email_check(app: &tauri::AppHandle, force: bool) {
    let result = do_email_check(app, force);
    let state = app.state::<EmailState>();
    *state.0.lock().unwrap() = result;
}

fn do_email_check(app: &tauri::AppHandle, force: bool) -> String {
    let prefs = match load_prefs_internal() {
        Ok(p) => p,
        Err(e) => return format!("Failed to load preferences: {}", e),
    };
    if !prefs.email_alerts_enabled.unwrap_or(false) {
        return "skipped (email alerts disabled)".into();
    }

    let items = {
        let db = app.state::<DbState>();
        let inner = match db.inner.lock() {
            Ok(i) => i,
            Err(_) => return "skipped (database locked)".into(),
        };
        let conn = match &inner.conn {
            Some(c) => c,
            None => return "skipped (no database open)".into(),
        };
        match low_stock_items(conn) {
            Ok(i) => i,
            Err(e) => return format!("Failed to query stock: {}", e),
        }
    };
    if items.is_empty() {
        return "ok (no low stock items)".into();
    }

    let fired_index = if force { None } else { slot_due_index(&prefs) };
    if !force && fired_index.is_none() {
        return "skipped (not a scheduled time yet)".into();
    }

    let subject = "🚨 INVENTORY ALERT".to_string();
    let html = build_digest_html(&items);
    match send_alert_email(&prefs, subject, html) {
        Ok(()) => {
            if let Some(idx) = fired_index {
                mark_slot_fired(idx);
            }
            format!("sent ({})", items.len())
        }
        Err(e) => e,
    }
}

#[tauri::command]
fn check_stock_alerts(app: tauri::AppHandle) -> Result<(), String> {
    let handle = app.clone();
    std::thread::spawn(move || {
        email_check(&handle, true);
        let prefs = match load_prefs_internal() {
            Ok(p) => p,
            Err(_) => return,
        };
        if prefs.desktop_notifications.unwrap_or(false) {
            let db = handle.state::<DbState>();
            let inner = match db.inner.lock() {
                Ok(i) => i,
                Err(_) => return,
            };
            let conn = match &inner.conn {
                Some(c) => c,
                None => return,
            };
            let items = match low_stock_items(conn) {
                Ok(i) => i,
                Err(_) => return,
            };
            if !items.is_empty() {
                notify_now(&handle, items.len());
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn test_email_connection() -> Result<String, String> {
    let prefs = load_prefs_internal()?;
    if !prefs.email_alerts_enabled.unwrap_or(false) {
        return Err("Email alerts are disabled in settings".into());
    }
    let subject = "[DBReader] Test email".into();
    let html = "<html><body style=\"font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;\"><h2>DBReader test email</h2><p>If you received this, email alerts are configured correctly.</p></body></html>".into();
    send_alert_email(&prefs, subject, html)?;
    Ok("sent".into())
}

#[tauri::command]
fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    send_notification(&app, "Test notification — low stock alerts are working.");
    Ok(())
}

#[tauri::command]
fn get_email_last_error(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<EmailState>();
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/* ==================== Desktop notifications ==================== */

struct NotificationState(Mutex<Option<std::time::SystemTime>>);

fn send_notification(app: &tauri::AppHandle, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let result = app
        .notification()
        .builder()
        .title("🚨 INVENTORY ALERT".to_string())
        .body(body.to_string())
        .show();
    if let Err(e) = result {
        eprintln!("Notification failed: {}", e);
    }
}

fn notification_check(app: &tauri::AppHandle) {
    let prefs = match load_prefs_internal() {
        Ok(p) => p,
        Err(_) => return,
    };
    if !prefs.desktop_notifications.unwrap_or(false) {
        return;
    }
    let items = {
        let db = app.state::<DbState>();
        let inner = match db.inner.lock() {
            Ok(i) => i,
            Err(_) => return,
        };
        let conn = match &inner.conn {
            Some(c) => c,
            None => return,
        };
        match low_stock_items(conn) {
            Ok(i) => i,
            Err(_) => return,
        }
    };
    if items.is_empty() {
        return;
    }
    let state = app.state::<NotificationState>();
    let mut guard = match state.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let now = std::time::SystemTime::now();
    let now_hour = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / 3600)
        .unwrap_or(0);
    let fire = match *guard {
        None => true,
        Some(last) => last
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() / 3600 != now_hour)
            .unwrap_or(true),
    };
    if fire {
        send_notification(app, &format!("{} item(s) low or out of stock", items.len()));
        *guard = Some(now);
    }
}

fn notify_now(app: &tauri::AppHandle, count: usize) {
    let state = app.state::<NotificationState>();
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(std::time::SystemTime::now());
    }
    send_notification(app, &format!("{} item(s) low or out of stock", count));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(INVENTORY_SCHEMA).unwrap();
        conn.execute_batch(SEED_DATA).unwrap();
        conn
    }

    #[test]
    fn test_schema_creates_all_tables() {
        let conn = setup_db();
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).unwrap();
        let tables: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap()
            .filter_map(|r| r.ok()).collect();
        let expected = [
            "batches", "calendar_events", "categories", "category_attribute_templates",
            "client_reservations", "clients", "inventory_logs", "providers",
            "product_attributes", "product_notifications", "product_notes", "products",
            "unit_conversions",
        ];
        for t in &expected {
            assert!(tables.contains(&t.to_string()), "Missing table: {}", t);
        }
    }

    #[test]
    fn test_schema_creates_indexes() {
        let conn = setup_db();
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
        ).unwrap();
        let indexes: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap()
            .filter_map(|r| r.ok()).collect();
        let expected = [
            "idx_attributes_product", "idx_batches_product_date", "idx_batches_status",
            "idx_calendar_date", "idx_calendar_product", "idx_clients_name",
            "idx_logs_batch", "idx_logs_created", "idx_notes_product",
            "idx_notifications_product", "idx_products_category", "idx_products_sku",
            "idx_reservations_client", "idx_reservations_product", "idx_templates_category",
        ];
        for idx in &expected {
            assert!(indexes.contains(&idx.to_string()), "Missing index: {}", idx);
        }
    }

    #[test]
    fn test_seed_categories() {
        let conn = setup_db();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 8);
    }

    #[test]
    fn test_seed_products() {
        let conn = setup_db();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM products", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 12);
    }

    #[test]
    fn test_seed_batches() {
        let conn = setup_db();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM batches", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 15);
    }

    #[test]
    fn test_seed_providers() {
        let conn = setup_db();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 5);
    }

    #[test]
    fn test_seed_inventory_logs() {
        let conn = setup_db();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM inventory_logs", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 27);
    }

    #[test]
    fn test_product_belongs_to_category() {
        let conn = setup_db();
        let category: String = conn.query_row(
            "SELECT c.name FROM products p JOIN categories c ON p.category_id = c.id WHERE p.sku = 'WINE-R-001'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(category, "Red Wine");
    }

    #[test]
    fn test_batch_status_default() {
        let conn = setup_db();
        let status: String = conn.query_row(
            "SELECT status FROM batches WHERE batch_number = 'LOT-2024-001'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(status, "in_inventory");
    }

    #[test]
    fn test_in_transaction_types_are_valid() {
        let conn = setup_db();
        let mut stmt = conn.prepare("SELECT DISTINCT transaction_type FROM inventory_logs").unwrap();
        let types: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap()
            .filter_map(|r| r.ok()).collect();
        for t in &types {
            assert!(["PURCHASE", "USAGE", "SPOILAGE", "ADJUSTMENT"].contains(&t.as_str()));
        }
    }

    #[test]
    fn test_foreign_key_cascade_category_delete() {
        let conn = setup_db();
        let cat_id: i64 = conn.query_row("SELECT id FROM categories WHERE name = 'Red Wine'", [], |row| row.get(0)).unwrap();
        conn.execute("UPDATE products SET category_id = NULL WHERE category_id = ?", rusqlite::params![cat_id]).unwrap();
        conn.execute("DELETE FROM category_attribute_templates WHERE category_id = ?", rusqlite::params![cat_id]).unwrap();
        conn.execute("DELETE FROM categories WHERE id = ?", rusqlite::params![cat_id]).unwrap();
        let orphans: i64 = conn.query_row(
            "SELECT COUNT(*) FROM products WHERE category_id IS NULL AND name = 'Château Margaux 2015'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(orphans, 1);
    }

    #[test]
    fn test_foreign_key_cascade_product_delete_deletes_attributes() {
        let conn = setup_db();
        let product_id: i64 = conn.query_row("SELECT id FROM products WHERE sku = 'WINE-R-001'", [], |row| row.get(0)).unwrap();
        conn.execute("DELETE FROM unit_conversions WHERE product_id = ?", rusqlite::params![product_id]).unwrap();
        conn.execute("DELETE FROM inventory_logs WHERE batch_id IN (SELECT id FROM batches WHERE product_id = ?)", rusqlite::params![product_id]).unwrap();
        conn.execute("DELETE FROM batches WHERE product_id = ?", rusqlite::params![product_id]).unwrap();
        conn.execute("DELETE FROM product_notes WHERE product_id = ?", rusqlite::params![product_id]).unwrap();
        conn.execute("DELETE FROM client_reservations WHERE product_id = ?", rusqlite::params![product_id]).unwrap();
        conn.execute("DELETE FROM calendar_events WHERE product_id = ?", rusqlite::params![product_id]).unwrap();
        conn.execute("DELETE FROM product_notifications WHERE product_id = ?", rusqlite::params![product_id]).unwrap();
        conn.execute("DELETE FROM products WHERE id = ?", rusqlite::params![product_id]).unwrap();
        let attr_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM product_attributes WHERE product_id = ?", rusqlite::params![product_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(attr_count, 0);
    }

    #[test]
    fn test_insert_product_and_read() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Test Wine', 'TST-001', 'bottle', 5)",
            [],
        ).unwrap();
        let (name, sku): (String, String) = conn.query_row(
            "SELECT name, sku FROM products WHERE sku = 'TST-001'", [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(name, "Test Wine");
        assert_eq!(sku, "TST-001");
    }

    #[test]
    fn test_execute_query_select() {
        let conn = setup_db();
        let sql = "SELECT name FROM products ORDER BY name LIMIT 1";
        let mut stmt = conn.prepare(sql).unwrap();
        let name: String = stmt.query_row([], |row| row.get(0)).unwrap();
        assert!(!name.is_empty());
    }

    #[test]
    fn test_execute_query_insert_update_delete() {
        let conn = setup_db();
        conn.execute("INSERT INTO providers (name, sub_name) VALUES ('Test', 'Shelf 1')", []).unwrap();
        let id: i64 = conn.query_row("SELECT id FROM providers WHERE name = 'Test'", [], |row| row.get(0)).unwrap();
        conn.execute("UPDATE providers SET sub_name = 'Shelf 2' WHERE id = ?", rusqlite::params![id]).unwrap();
        let sub: String = conn.query_row("SELECT sub_name FROM providers WHERE id = ?", rusqlite::params![id], |row| row.get(0)).unwrap();
        assert_eq!(sub, "Shelf 2");
        conn.execute("DELETE FROM providers WHERE id = ?", rusqlite::params![id]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM providers WHERE id = ?", rusqlite::params![id], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_upsert_product_attribute_insert() {
        let conn = setup_db();
        let pid: i64 = conn.query_row("SELECT id FROM products LIMIT 1", [], |row| row.get(0)).unwrap();
        let key = "test_attr".to_string();
        let val = "test_val".to_string();
        let dt = "string".to_string();
        let existing: Option<i64> = conn.query_row(
            "SELECT id FROM product_attributes WHERE product_id = ?1 AND attr_key = ?2",
            rusqlite::params![pid, key], |row| row.get(0),
        ).ok();
        assert!(existing.is_none());
        conn.execute(
            "INSERT INTO product_attributes (product_id, attr_key, attr_value, data_type) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![pid, key, val, dt],
        ).unwrap();
        let new_id: i64 = conn.last_insert_rowid();
        let fetched: String = conn.query_row(
            "SELECT attr_value FROM product_attributes WHERE id = ?1",
            rusqlite::params![new_id], |row| row.get(0),
        ).unwrap();
        assert_eq!(fetched, "test_val");
    }

    #[test]
    fn test_upsert_product_attribute_update() {
        let conn = setup_db();
        let pid: i64 = conn.query_row("SELECT id FROM products LIMIT 1", [], |row| row.get(0)).unwrap();
        let key = "Vintage".to_string();
        let existing_id: i64 = conn.query_row(
            "SELECT id FROM product_attributes WHERE product_id = ?1 AND attr_key = ?2",
            rusqlite::params![pid, key], |row| row.get(0),
        ).unwrap();
        conn.execute(
            "UPDATE product_attributes SET attr_value = '2020' WHERE id = ?1",
            rusqlite::params![existing_id],
        ).unwrap();
        let val: String = conn.query_row(
            "SELECT attr_value FROM product_attributes WHERE id = ?1",
            rusqlite::params![existing_id], |row| row.get(0),
        ).unwrap();
        assert_eq!(val, "2020");
    }

    #[test]
    fn test_batch_status_validation() {
        let conn = setup_db();
        let bid: i64 = conn.query_row("SELECT id FROM batches LIMIT 1", [], |row| row.get(0)).unwrap();
        let valid_statuses = ["ordered", "shipping", "arrived", "in_inventory", "used", "reserved"];
        for status in &valid_statuses {
            conn.execute(
                "UPDATE batches SET status = ?1 WHERE id = ?2",
                rusqlite::params![status, bid],
            ).unwrap();
            let current: String = conn.query_row(
                "SELECT status FROM batches WHERE id = ?1",
                rusqlite::params![bid], |row| row.get(0),
            ).unwrap();
            assert_eq!(&current, status);
        }
    }

    #[test]
    fn test_batch_invalid_status_rejected() {
        let conn = setup_db();
        let result = conn.execute_batch(
            "UPDATE batches SET status = 'invalid_status' WHERE id = 1"
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_upsert_category_insert_and_update() {
        let conn = setup_db();
        conn.execute(
            "INSERT OR IGNORE INTO categories (name, description, icon, color) VALUES ('TestCat', 'desc', '🔴', '#ff0000')",
            [],
        ).unwrap();
        let desc: String = conn.query_row(
            "SELECT description FROM categories WHERE name = 'TestCat'", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(desc, "desc");
        conn.execute(
            "UPDATE categories SET description = 'updated' WHERE name = 'TestCat'", [],
        ).unwrap();
        let desc2: String = conn.query_row(
            "SELECT description FROM categories WHERE name = 'TestCat'", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(desc2, "updated");
    }

    #[test]
    fn test_delete_category_cleans_up_products() {
        let conn = setup_db();
        let cat_id: i64 = conn.query_row("SELECT id FROM categories LIMIT 1", [], |row| row.get(0)).unwrap();
        conn.execute("UPDATE products SET category_id = NULL WHERE category_id = ?", rusqlite::params![cat_id]).unwrap();
        conn.execute("DELETE FROM category_attribute_templates WHERE category_id = ?", rusqlite::params![cat_id]).unwrap();
        conn.execute("DELETE FROM categories WHERE id = ?", rusqlite::params![cat_id]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM categories WHERE id = ?", rusqlite::params![cat_id], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_get_tables_query() {
        let conn = setup_db();
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).unwrap();
        let tables: Vec<String> = stmt.query_map([], |row| row.get(0)).unwrap()
            .filter_map(|r| r.ok()).collect();
        assert!(tables.len() >= 13);
    }

    #[test]
    fn test_get_table_columns() {
        let conn = setup_db();
        let mut stmt = conn.prepare("PRAGMA table_info('products')").unwrap();
        let columns: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap()
            .filter_map(|r| r.ok()).collect();
        assert!(columns.contains(&"name".to_string()));
        assert!(columns.contains(&"sku".to_string()));
        assert!(columns.contains(&"category_id".to_string()));
    }

    #[test]
    fn test_get_product_report_data_query() {
        let conn = setup_db();
        let pid: i64 = conn.query_row("SELECT id FROM products LIMIT 1", [], |row| row.get(0)).unwrap();
        let product_name: String = conn.query_row(
            "SELECT p.name FROM products p WHERE p.id = ?1",
            rusqlite::params![pid], |row| row.get(0),
        ).unwrap();
        assert!(!product_name.is_empty());
        let attr_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM product_attributes WHERE product_id = ?1",
            rusqlite::params![pid], |row| row.get(0),
        ).unwrap();
        assert!(attr_count > 0);
    }

    #[test]
    fn test_unit_conversions_exist() {
        let conn = setup_db();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM unit_conversions", [], |row| row.get(0)).unwrap();
        assert!(count > 0);
    }

    #[test]
    fn test_category_templates_exist() {
        let conn = setup_db();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM category_attribute_templates", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 23);
    }

    #[test]
    fn test_sql_injection_prevention() {
        let conn = setup_db();
        let malicious_name = "Robert'; DROP TABLE products; --";
        conn.execute(
            "INSERT INTO categories (name) VALUES (?)", rusqlite::params![malicious_name],
        ).unwrap();
        let table_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='products'", [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(table_count, 1, "products table should still exist");
    }

    #[test]
    fn test_migrate_schema_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(INVENTORY_SCHEMA).unwrap();
        conn.execute_batch(SEED_DATA).unwrap();
        let run_migration = |conn: &Connection| {
            conn.execute_batch("ALTER TABLE batches ADD COLUMN status VARCHAR(30) DEFAULT 'in_inventory';").ok();
            conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);").ok();
            conn.execute_batch("ALTER TABLE categories ADD COLUMN description TEXT;").ok();
            conn.execute_batch("ALTER TABLE categories ADD COLUMN icon VARCHAR(10) DEFAULT '📋';").ok();
            conn.execute_batch("ALTER TABLE categories ADD COLUMN color VARCHAR(20) DEFAULT '#5b6abf';").ok();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS category_attribute_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, attr_key VARCHAR(100) NOT NULL, attr_type VARCHAR(20) DEFAULT 'string', is_required INTEGER DEFAULT 0, display_order INTEGER DEFAULT 0, UNIQUE(category_id, attr_key));").ok();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS product_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, title VARCHAR(255), body TEXT NOT NULL, is_pinned INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(50), company VARCHAR(255), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS client_reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, quantity NUMERIC(10, 2) NOT NULL DEFAULT 1, reserved_date DATE NOT NULL, fulfilled_date DATE, status VARCHAR(30) DEFAULT 'reserved' CHECK (status IN ('reserved', 'partial', 'fulfilled', 'cancelled')), notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER REFERENCES products(id) ON DELETE CASCADE, title VARCHAR(255) NOT NULL, event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('purchase', 'shipping', 'delivery', 'tasting', 'reservation', 'custom')), event_date DATE NOT NULL, end_date DATE, quantity NUMERIC(10, 2), notes TEXT, is_completed INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS product_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('low_stock', 'expiry', 'custom', 'reorder', 'reservation')), message TEXT NOT NULL, threshold_value NUMERIC(10, 2), is_active INTEGER DEFAULT 1, last_triggered TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);").ok();
        };
        run_migration(&conn);
        run_migration(&conn);
        let tables: Vec<String> = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).unwrap().query_map([], |row| row.get(0)).unwrap().filter_map(|r| r.ok()).collect();
        assert_eq!(tables.len(), 13);
    }

    #[test]
    fn test_product_attributes_count_by_product() {
        let conn = setup_db();
        let mut stmt = conn.prepare(
            "SELECT p.name, COUNT(pa.id) FROM products p LEFT JOIN product_attributes pa ON pa.product_id = p.id GROUP BY p.id ORDER BY p.name"
        ).unwrap();
        let rows: Vec<(String, i64)> = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        }).unwrap().filter_map(|r| r.ok()).collect();
        assert!(rows.len() == 12);
        let margaux = rows.iter().find(|(n, _)| n.starts_with("Château Margaux")).unwrap();
        assert_eq!(margaux.1, 4);
    }

    #[test]
    fn test_notes_crud() {
        let conn = setup_db();
        let pid: i64 = conn.query_row("SELECT id FROM products LIMIT 1", [], |row| row.get(0)).unwrap();
        conn.execute(
            "INSERT INTO product_notes (product_id, title, body, is_pinned) VALUES (?1, 'Test Note', 'Test body', 1)",
            rusqlite::params![pid],
        ).unwrap();
        let note_id = conn.last_insert_rowid();
        let (title, pinned): (String, bool) = conn.query_row(
            "SELECT title, is_pinned FROM product_notes WHERE id = ?1",
            rusqlite::params![note_id],
            |row| Ok((row.get(0)?, row.get::<_, i32>(1)? != 0)),
        ).unwrap();
        assert_eq!(title, "Test Note");
        assert!(pinned);
        conn.execute("UPDATE product_notes SET body = 'Updated' WHERE id = ?1", rusqlite::params![note_id]).unwrap();
        let body: String = conn.query_row("SELECT body FROM product_notes WHERE id = ?1", rusqlite::params![note_id], |row| row.get(0)).unwrap();
        assert_eq!(body, "Updated");
        conn.execute("DELETE FROM product_notes WHERE id = ?1", rusqlite::params![note_id]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM product_notes WHERE id = ?1", rusqlite::params![note_id], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_clients_crud() {
        let conn = setup_db();
        conn.execute("INSERT INTO clients (name, email, phone) VALUES ('John Doe', 'john@test.com', '555-0100')", []).unwrap();
        let cid = conn.last_insert_rowid();
        let email: String = conn.query_row("SELECT email FROM clients WHERE id = ?1", rusqlite::params![cid], |row| row.get(0)).unwrap();
        assert_eq!(email, "john@test.com");
        conn.execute("DELETE FROM client_reservations WHERE client_id = ?1", rusqlite::params![cid]).ok();
        conn.execute("DELETE FROM clients WHERE id = ?1", rusqlite::params![cid]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM clients WHERE id = ?1", rusqlite::params![cid], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_calendar_events_crud() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO calendar_events (product_id, title, event_type, event_date) VALUES (1, 'Tasting', 'tasting', '2025-01-15')",
            [],
        ).unwrap();
        let eid = conn.last_insert_rowid();
        conn.execute("UPDATE calendar_events SET is_completed = 1 WHERE id = ?1", rusqlite::params![eid]).unwrap();
        let completed: bool = conn.query_row(
            "SELECT is_completed FROM calendar_events WHERE id = ?1",
            rusqlite::params![eid],
            |row| Ok(row.get::<_, i32>(0)? != 0),
        ).unwrap();
        assert!(completed);
        conn.execute("DELETE FROM calendar_events WHERE id = ?1", rusqlite::params![eid]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM calendar_events WHERE id = ?1", rusqlite::params![eid], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_notifications_crud() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO product_notifications (product_id, notification_type, message, threshold_value, is_active) VALUES (1, 'low_stock', 'Stock low', 10.0, 1)",
            [],
        ).unwrap();
        let nid = conn.last_insert_rowid();
        let msg: String = conn.query_row("SELECT message FROM product_notifications WHERE id = ?1", rusqlite::params![nid], |row| row.get(0)).unwrap();
        assert_eq!(msg, "Stock low");
        conn.execute("DELETE FROM product_notifications WHERE id = ?1", rusqlite::params![nid]).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM product_notifications WHERE id = ?1", rusqlite::params![nid], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_reservations_with_client() {
        let conn = setup_db();
        conn.execute("INSERT INTO clients (name) VALUES ('Test Client')", []).unwrap();
        let cid = conn.last_insert_rowid();
        let pid: i64 = conn.query_row("SELECT id FROM products LIMIT 1", [], |row| row.get(0)).unwrap();
        conn.execute(
            "INSERT INTO client_reservations (client_id, product_id, quantity, reserved_date, status) VALUES (?1, ?2, 3, '2025-02-01', 'reserved')",
            rusqlite::params![cid, pid],
        ).unwrap();
        let rid = conn.last_insert_rowid();
        let qty: f64 = conn.query_row("SELECT quantity FROM client_reservations WHERE id = ?1", rusqlite::params![rid], |row| row.get(0)).unwrap();
        assert!((qty - 3.0).abs() < 0.001);
        conn.execute("DELETE FROM client_reservations WHERE id = ?1", rusqlite::params![rid]).unwrap();
        conn.execute("DELETE FROM clients WHERE id = ?1", rusqlite::params![cid]).unwrap();
    }

    #[test]
    fn test_unique_sku_constraint() {
        let conn = setup_db();
        let result = conn.execute(
            "INSERT INTO products (category_id, name, sku, base_unit_name) VALUES (1, 'Duplicate SKU', 'WINE-R-001', 'bottle')",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_unique_category_name() {
        let conn = setup_db();
        let result = conn.execute(
            "INSERT INTO categories (name) VALUES ('Red Wine')",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_preferences_path_format() {
        let home = std::env::var("HOME").unwrap();
        let expected = std::path::PathBuf::from(&home).join(".dbreader-state.json");
        assert_eq!(prefs_path().unwrap(), expected);
    }

    #[test]
    fn test_strip_sql_comments_line() {
        let result = strip_sql_comments("-- comment\nSELECT * FROM t");
        assert_eq!(result.trim(), "SELECT * FROM t");
    }

    #[test]
    fn test_strip_sql_comments_block() {
        let result = strip_sql_comments("/* block */SELECT * FROM t");
        assert_eq!(result.trim(), "SELECT * FROM t");
    }

    #[test]
    fn test_strip_sql_comments_none() {
        let result = strip_sql_comments("SELECT * FROM t");
        assert_eq!(result.trim(), "SELECT * FROM t");
    }

    #[test]
    fn test_strip_sql_comments_with_cte() {
        let result = strip_sql_comments("WITH cte AS (SELECT 1) SELECT * FROM cte");
        assert_eq!(result.trim(), "WITH cte AS (SELECT 1) SELECT * FROM cte");
    }

    #[test]
    fn test_strip_sql_comments_mixed() {
        let sql = "-- line\nSELECT *\n/* block */\nFROM t";
        let result = strip_sql_comments(sql);
        assert_eq!(result.trim(), "SELECT *\n\nFROM t");
    }

    #[test]
    fn test_is_valid_table_name_valid() {
        assert!(is_valid_table_name("products"));
        assert!(is_valid_table_name("inventory_logs"));
    }

    #[test]
    fn test_is_valid_table_name_invalid() {
        assert!(!is_valid_table_name(""));
        assert!(!is_valid_table_name("products; DROP TABLE"));
    }

    #[test]
    fn test_safe_quote() {
        assert_eq!(safe_quote("products"), "\"products\"");
        assert_eq!(safe_quote("table\"name"), "\"table\"\"name\"");
    }
}

#[tauri::command]
fn print_report(app: tauri::AppHandle, html: String) -> Result<(), String> {
    let state = app.state::<PrintState>();
    *state.0.lock().unwrap() = Some(html);
    if let Some(win) = app.get_webview_window("print-window") {
        let _ = win.set_focus();
        let _ = win.eval("window.location.reload()");
    } else {
        let win = WebviewWindowBuilder::new(
            &app,
            "print-window",
            WebviewUrl::App("print.html".into()),
        )
        .title("DBReader Print")
        .inner_size(800.0, 1000.0)
        .build()
        .map_err(|e| e.to_string())?;
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn get_print_html(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<PrintState>();
    let html = state.0.lock().unwrap().clone();
    html.ok_or_else(|| "no print html pending".into())
}

#[tauri::command]
fn resize_print_window(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("print-window") {
        let h = height.clamp(400.0, 20000.0);
        win.set_size(tauri::LogicalSize::new(width, h))
            .map_err(|e| e.to_string())
    } else {
        Err("print window not found".into())
    }
}

#[tauri::command]
fn print_ready(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::mpsc;
        use std::os::windows::ffi::OsStrExt;
        use tauri_plugin_dialog::DialogExt;
        use webview2_com_sys::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2PrintToPdfCompletedHandler, ICoreWebView2PrintToPdfCompletedHandler_Impl,
            ICoreWebView2_7,
        };
        use windows_core::{implement, BOOL, HRESULT, PCWSTR};

        let save_path = app
            .dialog()
            .file()
            .add_filter("PDF", &["pdf"])
            .set_file_name("dbreader-report.pdf")
            .blocking_save_file();
        let Some(save_path) = save_path else {
            if let Some(win) = app.get_webview_window("print-window") {
                let _ = win.close();
            }
            return Ok(());
        };
        let save_path = save_path.into_path().map_err(|e| e.to_string())?;
        let path_wide: Vec<u16> = save_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let pcwstr = PCWSTR::from_raw(path_wide.as_ptr());

        #[implement(ICoreWebView2PrintToPdfCompletedHandler)]
        struct PrintPdfHandler {
            tx: mpsc::Sender<Result<(), String>>,
        }

        impl ICoreWebView2PrintToPdfCompletedHandler_Impl for PrintPdfHandler_Impl {
            fn Invoke(
                &self,
                error_code: HRESULT,
                is_successful: BOOL,
            ) -> windows_core::Result<()> {
                if error_code.is_ok() && is_successful.as_bool() {
                    let _ = self.tx.send(Ok(()));
                } else {
                    let _ = self
                        .tx
                        .send(Err(format!("PrintToPdf failed: error {error_code:?}")));
                }
                Ok(())
            }
        }

        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let app_for_thread = app.clone();
        app.run_on_main_thread(move || {
            let Some(win) = app_for_thread.get_webview_window("print-window") else {
                let _ = tx.send(Err("print window not found".into()));
                return;
            };
            let _ = win.set_focus();
            let inner_tx = tx.clone();
            let res = win.with_webview(move |webview| {
                use windows_core::Interface;
                unsafe {
                    let controller = webview.controller();
                    let core = match controller.CoreWebView2() {
                        Ok(c) => c,
                        Err(e) => {
                            let _ = inner_tx.send(Err(format!("WebView2 core: {}", e)));
                            return;
                        }
                    };
                    let v7: ICoreWebView2_7 = match core.cast() {
                        Ok(v) => v,
                        Err(e) => {
                            let _ =
                                inner_tx.send(Err(format!("WebView2 print interface: {}", e)));
                            return;
                        }
                    };
                    let handler: ICoreWebView2PrintToPdfCompletedHandler =
                        PrintPdfHandler { tx: inner_tx.clone() }.into();
                    if let Err(e) = v7.PrintToPdf(pcwstr, None, &handler) {
                        let _ = inner_tx.send(Err(format!("PrintToPdf: {}", e)));
                        return;
                    }
                }
            });
            if let Err(e) = res {
                let _ = tx.send(Err(format!("print webview access: {}", e)));
            }
        })
        .map_err(|e| e.to_string())?;
        let result = rx.recv().map_err(|e| e.to_string())?;
        if let Some(win) = app.get_webview_window("print-window") {
            let _ = win.close();
        }
        result
    }
    #[cfg(not(target_os = "windows"))]
    {
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let app_for_thread = app.clone();
        app.run_on_main_thread(move || {
            let result = if let Some(win) = app_for_thread.get_webview_window("print-window") {
                let _ = win.set_focus();
                win.print().map_err(|e| e.to_string())
            } else {
                Err("print window not found".into())
            };
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
}

#[tauri::command]
fn close_print_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("print-window") {
        win.close().map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let dir = std::path::PathBuf::from(&home).join("Library/LaunchAgents");
        let path = dir.join("com.vincentleong.dbreader.plist");
        if enabled {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let plist = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                 <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
                 <plist version=\"1.0\">\n\
                 <dict>\n\
                 \t<key>Label</key>\n\
                 \t<string>com.vincentleong.dbreader</string>\n\
                 \t<key>ProgramArguments</key>\n\
                 \t<array>\n\
                 \t\t<string>{}</string>\n\
                 \t\t<string>--background</string>\n\
                 \t</array>\n\
                 \t<key>RunAtLoad</key>\n\
                 \t<true/>\n\
                 \t<key>ProcessType</key>\n\
                 \t<string>Interactive</string>\n\
                 </dict>\n\
                 </plist>\n",
                exe.display()
            );
            std::fs::write(&path, plist).map_err(|e| e.to_string())?;
        } else {
            let _ = std::fs::remove_file(&path);
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut cmd = std::process::Command::new("schtasks");
        if enabled {
            cmd.args(["/Create", "/TN", "DBReader", "/TR"])
                .arg(format!("\"{}\" --background", exe.display()))
                .args(["/SC", "ONLOGON", "/F"]);
        } else {
            cmd.args(["/Delete", "/TN", "DBReader", "/F"]);
        }
        let out = cmd.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).into_owned())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(())
    }
}

fn tray_icon_image() -> tauri::image::Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let cx = 15.5f64;
    let cy = 15.5f64;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let d = ((x as f64 - cx).powi(2) + (y as f64 - cy).powi(2)).sqrt();
            let idx = ((y * SIZE + x) * 4) as usize;
            if d <= 13.0 {
                rgba[idx] = 232;
                rgba[idx + 1] = 62;
                rgba[idx + 2] = 48;
                rgba[idx + 3] = 255;
            } else if d <= 16.0 {
                rgba[idx] = 232;
                rgba[idx + 1] = 62;
                rgba[idx + 2] = 48;
                rgba[idx + 3] = 120;
            } else {
                rgba[idx + 3] = 0;
            }
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start_hidden = std::env::args().any(|a| a == "--background");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .manage(DbState {
            inner: Mutex::new(InnerState {
                conn: None,
                path: None,
            }),
        })
        .manage(PrintState(Mutex::new(None)))
        .manage(EmailState(Mutex::new("No check performed yet".into())))
        .manage(NotificationState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            open_database,
            print_report,
            get_print_html,
            resize_print_window,
            print_ready,
            close_print_window,
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
            check_stock_alerts,
            test_email_connection,
            test_notification,
            get_email_last_error,
            set_launch_at_login,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                email_check(&handle, false);
            });

            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                notification_check(&handle);
            });

            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;
            let show_i = MenuItem::with_id(app, "show", "Open DBReader", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit DBReader", true, None::<&str>)
                .map_err(|e| e.to_string())?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i]).map_err(|e| e.to_string())?;
            let _tray = TrayIconBuilder::new()
                .icon(tray_icon_image())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)
                .map_err(|e| e.to_string())?;

            if start_hidden {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
