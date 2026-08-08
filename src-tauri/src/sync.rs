// Multi-device sync engine for DBReader.
//
// Every mutation on user tables with a declared primary key is captured by
// SQLite triggers into an append-only `_dbsync_log` inside the database.
// Devices exchange their logs through a transport (HTTPS relay or shared
// folder) and replay remote ops in (hlc, site, seq) order, which yields a
// deterministic last-write-wins merge per row on every device.

use rusqlite::{params_from_iter, types::Value as SqlValue, Connection, Row};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::DbState;

const LOG_TABLE: &str = "_dbsync_log";
const META_TABLE: &str = "_dbsync_meta";
const PUSH_BATCH: i64 = 500;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncOp {
    pub site: String,
    pub seq: i64,
    pub hlc: String,
    pub table: String,
    pub pk: serde_json::Value,
    #[serde(default)]
    pub row: Option<serde_json::Value>,
    pub op: String,
    #[serde(default)]
    pub pk_json_raw: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub db_open: bool,
    pub enabled: bool,
    pub site_id: String,
    pub db_id: String,
    pub transport: String,
    pub endpoint: String,
    pub token: String,
    pub schema_key: String,
    pub push_pending: i64,
    pub cursor: String,
    pub peers: Vec<String>,
    pub synced_tables: Vec<String>,
    pub skipped_tables: Vec<String>,
    pub last_sync: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Default, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub pushed: i64,
    pub applied: i64,
}

fn now_iso() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn is_plain_name(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

fn safe_string(s: &str) -> String {
    s.replace('\'', "''")
}

// ---------- meta ----------

fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    match conn.query_row(
        &format!("SELECT value FROM {} WHERE key = ?1", META_TABLE),
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    ) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read sync meta: {}", e)),
    }
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        &format!(
            "INSERT INTO {} (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            META_TABLE
        ),
        rusqlite::params![key, value],
    )
    .map_err(|e| format!("Failed to write sync meta: {}", e))?;
    Ok(())
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {} (
            site_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            hlc TEXT NOT NULL,
            table_name TEXT NOT NULL,
            pk_json TEXT NOT NULL,
            row_json TEXT,
            op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
            PRIMARY KEY (site_id, seq)
        );
        CREATE TABLE IF NOT EXISTS {} (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS _dbsync_session (
            id INTEGER PRIMARY KEY,
            active INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS _dbsync_field_clock (
            table_name TEXT NOT NULL,
            pk_json TEXT NOT NULL,
            column TEXT NOT NULL,
            hlc TEXT NOT NULL,
            PRIMARY KEY (table_name, pk_json, column)
        );
        CREATE INDEX IF NOT EXISTS idx_dbsync_hlc ON {} (hlc);",
        LOG_TABLE, META_TABLE, LOG_TABLE
    ))
    .map_err(|e| format!("Failed to create sync tables: {}", e))?;
    Ok(())
}

fn site_id_or_create(conn: &Connection) -> Result<String, String> {
    if let Some(s) = meta_get(conn, "site_id")? {
        return Ok(s);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    meta_set(conn, "site_id", &id)?;
    Ok(id)
}

// ---------- schema introspection ----------

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<(String, i32)>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", quote_ident(table)))
        .map_err(|e| format!("Failed to read table info: {}", e))?;
    let cols = stmt
        .query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, i32>(5)?)))
        .map_err(|e| format!("Failed to read columns: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read columns: {}", e))?;
    Ok(cols)
}

fn user_tables(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT name FROM sqlite_master
             WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '{}%'
             ORDER BY name",
            safe_string("_dbsync_")
        ))
        .map_err(|e| format!("Failed to query tables: {}", e))?;
    let tables = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to read tables: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read tables: {}", e))?;
    Ok(tables)
}

fn pk_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let cols = table_columns(conn, table)?;
    let mut pks: Vec<(i32, String)> = cols
        .iter()
        .filter(|(_, pk)| *pk > 0)
        .map(|(c, pk)| (*pk, c.clone()))
        .collect();
    pks.sort_by_key(|(n, _)| *n);
    Ok(pks.into_iter().map(|(_, c)| c).collect())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
            rusqlite::params![table],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to check table: {}", e))?;
    Ok(n > 0)
}

fn json_expr(cols: &[String], scope: &str) -> String {
    let parts: Vec<String> = cols
        .iter()
        .map(|c| {
            let q = format!("{}.{}", scope, quote_ident(c));
            format!(
                "'{}', CASE WHEN typeof({}) = 'blob' THEN NULL ELSE {} END",
                safe_string(c),
                q,
                q
            )
        })
        .collect();
    format!("json_object({})", parts.join(", "))
}

pub fn compute_schema_key(conn: &Connection) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut stmt = conn
        .prepare(
            "SELECT sql FROM sqlite_master
             WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_dbsync_%'
             ORDER BY name",
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    for sql in rows {
        hasher.update(sql.as_bytes());
        hasher.update(b"\n");
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for b in digest.iter() {
        use std::fmt::Write;
        let _ = write!(hex, "{:02x}", b);
    }
    Ok(hex)
}

// ---------- change capture triggers ----------

fn field_payload(cols: &[String], is_insert: bool) -> String {
    let mut rows = Vec::new();
    for c in cols {
        let k = safe_string(c);
        let v = format!("NEW.{}", quote_ident(c));
        let w = if is_insert {
            "WHERE 1".to_string()
        } else {
            format!("WHERE OLD.{} IS NOT NEW.{}", quote_ident(c), quote_ident(c))
        };
        rows.push(format!("SELECT '{}' AS k, {} AS v {}", k, v, w));
    }
    format!(
        "(SELECT json_group_object(k, v) FROM ({}))",
        rows.join(" UNION ALL ")
    )
}

pub fn ensure_triggers(conn: &Connection) -> Result<(Vec<String>, Vec<String>), String> {
    let mut synced = Vec::new();
    let mut skipped = Vec::new();
    let site_id = site_id_or_create(conn)?;
    let site_lit = safe_string(&site_id);
    let hlc_expr = "(SELECT CASE WHEN MAX(hlc) IS NULL THEN strftime('%Y%m%d%H%M%f','now') \
                                 ELSE MAX(MAX(hlc), strftime('%Y%m%d%H%M%f','now')) END \
                   FROM _dbsync_log)"
        .to_string();
    let seq_expr = format!(
        "(SELECT COALESCE(MAX(seq),0)+1 FROM _dbsync_log WHERE site_id='{}')",
        site_lit
    );
    let latest_hlc = format!(
        "(SELECT hlc FROM _dbsync_log WHERE site_id='{}' ORDER BY seq DESC LIMIT 1)",
        site_lit
    );
    for table in user_tables(conn)? {
        if !is_plain_name(&table) || table.len() > 60 {
            skipped.push(table.clone());
            continue;
        }
        let pks = pk_columns(conn, &table)?;
        if pks.is_empty() {
            skipped.push(table.clone());
            continue;
        }
        let mut all = pks.clone();
        let mut rest: Vec<String> = table_columns(conn, &table)?
            .into_iter()
            .map(|(c, _)| c)
            .filter(|c| !all.contains(c))
            .collect();
        all.append(&mut rest);

        let pk_expr = json_expr(&pks, "NEW");
        let old_pk_expr = json_expr(&pks, "OLD");
        let insert_payload = field_payload(&all, true);
        let update_payload = field_payload(&all, false);
        let table_lit = safe_string(&table);
        let guard = "NOT EXISTS (SELECT 1 FROM _dbsync_session WHERE active = 1)";

        let insert_body = format!(
            "INSERT INTO {log} (site_id, seq, hlc, table_name, pk_json, row_json, op) \
             SELECT '{site}', {seq}, {hlc}, '{table}', {pk}, {payload}, 'upsert' \
             WHERE {guard};
             INSERT INTO _dbsync_field_clock (table_name, pk_json, column, hlc) \
             SELECT '{table}', {pk}, key, {latest} FROM json_each({payload}) \
             WHERE {guard} \
             ON CONFLICT (table_name, pk_json, column) DO UPDATE SET hlc = excluded.hlc;",
            log = LOG_TABLE,
            site = site_lit,
            seq = seq_expr,
            hlc = hlc_expr,
            table = table_lit,
            pk = pk_expr,
            payload = insert_payload,
            guard = guard,
            latest = latest_hlc
        );

        let update_body = format!(
            "INSERT INTO {log} (site_id, seq, hlc, table_name, pk_json, row_json, op) \
             SELECT '{site}', {seq}, {hlc}, '{table}', {pk}, {payload}, 'upsert' \
             WHERE {guard} AND {payload} IS NOT NULL;
             INSERT INTO _dbsync_field_clock (table_name, pk_json, column, hlc) \
             SELECT '{table}', {pk}, key, {latest} FROM json_each({payload}) \
             WHERE {guard} \
             ON CONFLICT (table_name, pk_json, column) DO UPDATE SET hlc = excluded.hlc;",
            log = LOG_TABLE,
            site = site_lit,
            seq = seq_expr,
            hlc = hlc_expr,
            table = table_lit,
            pk = pk_expr,
            payload = update_payload,
            guard = guard,
            latest = latest_hlc
        );

        let delete_body = format!(
            "INSERT INTO {log} (site_id, seq, hlc, table_name, pk_json, row_json, op) \
             SELECT '{site}', {seq}, {hlc}, '{table}', {pk}, NULL, 'delete' \
             WHERE {guard};
             DELETE FROM _dbsync_field_clock \
             WHERE table_name = '{table}' AND pk_json = {pk};",
            log = LOG_TABLE,
            site = site_lit,
            seq = seq_expr,
            hlc = hlc_expr,
            table = table_lit,
            pk = old_pk_expr,
            guard = guard
        );

        let triggers = [
            ("_dbsync_i_", "_insert", "AFTER INSERT", insert_body),
            ("_dbsync_u_", "_update", "AFTER UPDATE", update_body),
            ("_dbsync_d_", "_delete", "AFTER DELETE", delete_body),
        ];
        for (prefix, suffix, when, body) in triggers {
            let name = format!("{}{}{}", prefix, table, suffix);
            conn.execute_batch(&format!(
                "CREATE TRIGGER IF NOT EXISTS \"{name}\" {when} ON \"{table}\" BEGIN {body} END;",
                name = safe_string(&name),
                when = when,
                table = safe_string(&table),
                body = body
            ))
            .map_err(|e| format!("Failed to create sync trigger on {}: {}", table, e))?;
        }
        synced.push(table);
    }
    Ok((synced, skipped))
}

// ---------- ops ----------

fn row_to_op(row: &Row) -> rusqlite::Result<SyncOp> {
    let table: String = row.get(3)?;
    let pk: String = row.get(4)?;
    let row_json: Option<String> = row.get(5)?;
    let pk = serde_json::from_str(&pk).unwrap_or(serde_json::Value::Null);
    let rowv = row_json
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str(&s).ok());
    Ok(SyncOp {
        site: row.get(0)?,
        seq: row.get(1)?,
        hlc: row.get(2)?,
        table,
        pk,
        row: rowv,
        op: row.get(6)?,
        pk_json_raw: row.get(4)?,
    })
}

fn local_ops(conn: &Connection, site_id: &str, push_after: i64) -> Result<Vec<SyncOp>, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT site_id, seq, hlc, table_name, pk_json, row_json, op
             FROM {} WHERE seq > ?1 AND site_id = ?2 ORDER BY seq LIMIT ?3",
            LOG_TABLE
        ))
        .map_err(|e| format!("Failed to read local ops: {}", e))?;
    let rows = stmt
        .query_map(
            rusqlite::params![push_after, site_id, PUSH_BATCH],
            row_to_op,
        )
        .map_err(|e| format!("Failed to read local ops: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read local ops: {}", e))?;
    Ok(rows)
}

fn store_remote_ops(conn: &Connection, ops: &[SyncOp]) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!(
            "INSERT OR IGNORE INTO {} (site_id, seq, hlc, table_name, pk_json, row_json, op)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            LOG_TABLE
        ))
        .map_err(|e| format!("Failed to prepare op store: {}", e))?;
    for op in ops {
        let pk_json = serde_json::to_string(&op.pk).unwrap_or_else(|_| "{}".into());
        let row_json = op
            .row
            .as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "null".into()));
        stmt.execute(rusqlite::params![
            op.site,
            op.seq,
            op.hlc,
            op.table,
            pk_json,
            row_json,
            op.op
        ])
        .map_err(|e| format!("Failed to store remote op: {}", e))?;
    }
    Ok(())
}

fn json_to_sql(v: &serde_json::Value) -> SqlValue {
    match v {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(b) => SqlValue::Integer(*b as i64),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Null
            }
        }
        serde_json::Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn op_pk_json(op: &SyncOp) -> String {
    if !op.pk_json_raw.is_empty() {
        op.pk_json_raw.clone()
    } else {
        serde_json::to_string(&op.pk).unwrap_or_else(|_| "{}".into())
    }
}

fn set_field_clock(
    conn: &Connection,
    table: &str,
    pk_json: &str,
    column: &str,
    hlc: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO _dbsync_field_clock (table_name, pk_json, column, hlc) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (table_name, pk_json, column) DO UPDATE SET hlc = excluded.hlc",
        rusqlite::params![table, pk_json, column, hlc],
    )
    .map_err(|e| format!("Failed to update field clock: {}", e))?;
    Ok(())
}

fn clear_field_clocks(conn: &Connection, table: &str, pk_json: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM _dbsync_field_clock WHERE table_name = ?1 AND pk_json = ?2",
        rusqlite::params![table, pk_json],
    )
    .map_err(|e| format!("Failed to clear field clocks: {}", e))?;
    Ok(())
}

fn apply_op(conn: &Connection, op: &SyncOp) -> Result<(), String> {
    let table = op.table.trim().to_string();
    if !is_plain_name(&table) {
        return Err("Invalid table name".into());
    }
    if !table_exists(conn, &table)? {
        return Err(format!("Table does not exist locally: {}", table));
    }
    let q = quote_ident(&table);
    let pk = match op.pk.as_object() {
        Some(o) => o,
        None => return Err("Invalid pk payload".into()),
    };
    if pk.is_empty() {
        return Err("Row has no primary key".into());
    }
    let pk_json = op_pk_json(op);
    let pk_cols: Vec<&String> = pk.keys().collect();
    let pk_sql = pk_cols
        .iter()
        .map(|c| format!("{} = ?", quote_ident(c)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let pk_vals: Vec<SqlValue> = pk.values().map(json_to_sql).collect();
    match op.op.as_str() {
        "delete" => {
            conn.execute(
                &format!("DELETE FROM {} WHERE {}", q, pk_sql),
                params_from_iter(&pk_vals),
            )
            .map_err(|e| format!("Delete failed on {}: {}", table, e))?;
            clear_field_clocks(conn, &table, &pk_json)?;
            Ok(())
        }
        "upsert" => {
            let row = op
                .row
                .as_ref()
                .and_then(|v| v.as_object())
                .ok_or_else(|| "Upsert op without row payload".to_string())?;
            let exists: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {} WHERE {}", q, pk_sql),
                    params_from_iter(&pk_vals),
                    |r| r.get(0),
                )
                .map_err(|e| format!("Row check failed on {}: {}", table, e))?;
            if exists == 0 {
                let mut cols: Vec<&String> = row.keys().collect();
                for c in &pk_cols {
                    if !cols.contains(c) {
                        cols.push(c);
                    }
                }
                let col_sql = cols
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");
                let ph = vec!["?"; cols.len()];
                let mut params: Vec<SqlValue> = Vec::new();
                for c in &cols {
                    params.push(match row.get(*c) {
                        Some(v) => json_to_sql(v),
                        None => match pk.get(*c) {
                            Some(v) => json_to_sql(v),
                            None => SqlValue::Null,
                        },
                    });
                }
                conn.execute(
                    &format!("INSERT INTO {} ({}) VALUES ({})", q, col_sql, ph.join(", ")),
                    params_from_iter(&params),
                )
                .map_err(|e| format!("Insert failed on {}: {}", table, e))?;
                for c in &cols {
                    set_field_clock(conn, &table, &pk_json, c, &op.hlc)?;
                }
                return Ok(());
            }
            for (k, v) in row {
                let mut params: Vec<SqlValue> = Vec::new();
                params.push(json_to_sql(v));
                params.extend(pk_vals.iter().cloned());
                params.push(SqlValue::Text(table.clone()));
                params.push(SqlValue::Text(pk_json.clone()));
                params.push(SqlValue::Text(k.clone()));
                params.push(SqlValue::Text(op.hlc.clone()));
                let matched = conn
                    .execute(
                        &format!(
                            "UPDATE {} SET {} = ? WHERE {} AND \
                             (SELECT COALESCE(hlc, '') FROM _dbsync_field_clock \
                              WHERE table_name = ? AND pk_json = ? AND column = ?) <= ?",
                            q,
                            quote_ident(k),
                            pk_sql
                        ),
                        params_from_iter(&params),
                    )
                    .map_err(|e| format!("Merge failed on {}: {}", table, e))?;
                if matched > 0 {
                    set_field_clock(conn, &table, &pk_json, k, &op.hlc)?;
                }
            }
            Ok(())
        }
        other => Err(format!("Unknown op type: {}", other)),
    }
}

fn cursor_after(cursor: &str) -> (String, String, i64) {
    let parts: Vec<&str> = cursor.split('|').collect();
    if parts.len() == 3 {
        (
            parts[0].to_string(),
            parts[1].to_string(),
            parts[2].parse::<i64>().unwrap_or(0),
        )
    } else {
        (String::new(), String::new(), 0)
    }
}

fn cursor_from(hlc: &str, site: &str, seq: i64) -> String {
    format!("{}|{}|{}", hlc, site, seq)
}

// ---------- transports ----------

trait Transport: Send {
    fn push(
        &self,
        db_id: &str,
        site_id: &str,
        schema_key: &str,
        ops: &[SyncOp],
    ) -> Result<(), String>;
    fn pull(&self, db_id: &str, after: &str, wait_ms: u32) -> Result<(Vec<SyncOp>, Vec<String>, String), String>;
}

struct RelayTransport {
    endpoint: String,
    token: String,
}

fn user_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::config::Config::builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .build()
            .new_agent()
    })
}

impl Transport for RelayTransport {
    fn push(
        &self,
        db_id: &str,
        site_id: &str,
        schema_key: &str,
        ops: &[SyncOp],
    ) -> Result<(), String> {
        let url = format!("{}/api/v1/push", self.endpoint.trim_end_matches('/'));
        let body = serde_json::json!({
            "db": db_id,
            "site": site_id,
            "schema": schema_key,
            "ops": ops,
        });
        let mut req = user_agent().post(&url);
        if !self.token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.token));
        }
        let resp = req
            .send_json(&body)
            .map_err(|e| format!("Relay push failed: {}", e))?;
        if resp.status() != 200 {
            return Err(format!("Relay push returned status {}", resp.status()));
        }
        Ok(())
    }

    fn pull(&self, db_id: &str, after: &str, wait_ms: u32) -> Result<(Vec<SyncOp>, Vec<String>, String), String> {
        let (h, site, seq) = cursor_after(after);
        let url = format!(
            "{}/api/v1/pull?db={}&h={}&site={}&seq={}&wait={}",
            self.endpoint.trim_end_matches('/'),
            db_id,
            h,
            site,
            seq,
            wait_ms
        );
        let mut req = user_agent().get(&url);
        if !self.token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.token));
        }
        let mut resp = req.call().map_err(|e| format!("Relay pull failed: {}", e))?;
        if resp.status() != 200 {
            return Err(format!("Relay pull returned status {}", resp.status()));
        }
        let value: serde_json::Value = resp
            .body_mut()
            .read_json()
            .map_err(|e| format!("Relay returned invalid JSON: {}", e))?;
        let ops: Vec<SyncOp> =
            serde_json::from_value(value.get("ops").cloned().unwrap_or_default())
                .map_err(|e| format!("Invalid ops payload: {}", e))?;
        let peers: Vec<String> =
            serde_json::from_value(value.get("sites").cloned().unwrap_or_default())
                .unwrap_or_default();
        let schema: String = value
            .get("schema")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok((ops, peers, schema))
    }
}

struct FolderTransport {
    root: PathBuf,
}

impl FolderTransport {
    fn db_dir(&self, db_id: &str) -> PathBuf {
        self.root.join("db").join(db_id)
    }

    fn site_dir(&self, db_id: &str, site_id: &str) -> PathBuf {
        self.db_dir(db_id).join("site").join(site_id)
    }

    fn read_meta(&self, db_id: &str, key: &str) -> Option<String> {
        std::fs::read_to_string(self.db_dir(db_id).join(format!("{}.json", key))).ok()
    }

    fn write_meta(&self, db_id: &str, key: &str, value: &str) -> Result<(), String> {
        let dir = self.db_dir(db_id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{}.json", key)), value).map_err(|e| e.to_string())
    }
}

impl Transport for FolderTransport {
    fn push(
        &self,
        db_id: &str,
        site_id: &str,
        schema_key: &str,
        ops: &[SyncOp],
    ) -> Result<(), String> {
        if ops.is_empty() {
            return Ok(());
        }
        let dir = self.site_dir(db_id, site_id);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let last_seq = ops.iter().map(|o| o.seq).max().unwrap_or(0);
        let file = dir.join(format!("{:012}.jsonl", last_seq));
        let mut content = String::new();
        for op in ops {
            content.push_str(&serde_json::to_string(op).map_err(|e| e.to_string())?);
            content.push('\n');
        }
        let tmp = dir.join(format!("{:012}.jsonl.tmp", last_seq));
        std::fs::write(&tmp, content).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
        if !schema_key.is_empty() {
            self.write_meta(db_id, "schema", schema_key)?;
        }
        Ok(())
    }

    fn pull(&self, db_id: &str, after: &str, _wait_ms: u32) -> Result<(Vec<SyncOp>, Vec<String>, String), String> {
        let db_dir = self.db_dir(db_id);
        let mut ops: Vec<SyncOp> = Vec::new();
        let mut peers = Vec::new();
        let site_root = db_dir.join("site");
        if site_root.exists() {
            let entries = std::fs::read_dir(&site_root)
                .map_err(|e| format!("Cannot read sync folder: {}", e))?;
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let site = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_string();
                peers.push(site.clone());
                let reads = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
                for f in reads.flatten() {
                    let fpath = f.path();
                    let fname = fpath
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or_default();
                    if !fname.ends_with(".jsonl") {
                        continue;
                    }
                    let content = std::fs::read_to_string(&fpath).map_err(|e| e.to_string())?;
                    for line in content.lines() {
                        if !line.is_empty() {
                            if let Ok(op) = serde_json::from_str::<SyncOp>(line) {
                                ops.push(op);
                            }
                        }
                    }
                }
            }
        }
        let schema = self.read_meta(db_id, "schema").unwrap_or_default();
        let (ah, as_, aseq) = cursor_after(after);
        ops.retain(|op| {
            op.hlc > ah
                || (op.hlc == ah
                    && (op.site > as_
                        || (op.site == as_ && op.seq > aseq)))
        });
        ops.sort_by(|a, b| {
            (a.hlc.as_str(), a.site.as_str(), a.seq).cmp(&(b.hlc.as_str(), b.site.as_str(), b.seq))
        });
        Ok((ops, peers, schema))
    }
}

fn default_folder_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|d| d.join("sync"))
        .unwrap_or_else(|_| PathBuf::from("dbreader-sync"))
}

fn make_transport(
    app: &AppHandle,
    kind: &str,
    endpoint: &str,
    token: &str,
) -> Result<Box<dyn Transport>, String> {
    match kind {
        "relay" => {
            if endpoint.trim().is_empty() {
                return Err("Relay endpoint is not set".into());
            }
            Ok(Box::new(RelayTransport {
                endpoint: endpoint.trim().to_string(),
                token: token.trim().to_string(),
            }))
        }
        "folder" => {
            let root = if endpoint.trim().is_empty() {
                default_folder_root(app)
            } else {
                PathBuf::from(endpoint.trim())
            };
            Ok(Box::new(FolderTransport { root }))
        }
        _ => Err(format!("Unknown sync transport: {}", kind)),
    }
}

// ---------- status ----------

fn status_from_conn(conn: &Connection, db_open: bool) -> Result<SyncStatus, String> {
    let enabled = meta_get(conn, "enabled")?.as_deref() == Some("1");
    let site_id = site_id_or_create(conn)?;
    let (synced, skipped) = ensure_triggers(conn)?;
    let push_after = meta_get(conn, "push_after")?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let pending = local_ops(conn, &site_id, push_after)?.len() as i64;
    let peers: Vec<String> = meta_get(conn, "peers")?
        .map(|s| serde_json::from_str(&s).unwrap_or_default())
        .unwrap_or_default();
    Ok(SyncStatus {
        db_open,
        enabled,
        site_id,
        db_id: meta_get(conn, "db_id")?.unwrap_or_default(),
        transport: meta_get(conn, "transport")?.unwrap_or_default(),
        endpoint: meta_get(conn, "endpoint")?.unwrap_or_default(),
        token: meta_get(conn, "token")?.unwrap_or_default(),
        schema_key: meta_get(conn, "schema_key")?.unwrap_or_default(),
        push_pending: pending,
        cursor: meta_get(conn, "cursor")?.unwrap_or_default(),
        peers,
        synced_tables: synced,
        skipped_tables: skipped,
        last_sync: meta_get(conn, "last_sync")?,
        last_error: meta_get(conn, "last_error")?,
    })
}

// ---------- sync flow ----------

/// Applies remote ops under a single transaction. The caller must hold the
/// DbState lock for the connection.
fn apply_batch(conn: &Connection, ops: &[SyncOp], after: &str) -> Result<i64, String> {
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF; BEGIN;
         INSERT INTO _dbsync_session (id, active) VALUES (1, 1)
         ON CONFLICT(id) DO UPDATE SET active = 1;",
    )
    .map_err(|e| format!("Failed to start sync transaction: {}", e))?;
    let mut applied = 0i64;
    let mut cursor = after.to_string();
    for op in ops {
        let key = cursor_from(&op.hlc, &op.site, op.seq);
        if key > cursor {
            cursor = key;
        }
        if apply_op(conn, op).is_err() {
            continue;
        }
        applied += 1;
    }
    let _ = store_remote_ops(conn, ops);
    meta_set(conn, "cursor", &cursor)?;
    conn.execute_batch(
        "COMMIT; PRAGMA foreign_keys = ON;
         UPDATE _dbsync_session SET active = 0 WHERE id = 1;",
    )
    .map_err(|e| format!("Commit sync transaction failed: {}", e))?;
    Ok(applied)
}

fn config_and_transport(app: &AppHandle) -> Result<Option<(String, String, Box<dyn Transport>)>, String> {
    let (db_id, site_id, kind, endpoint, token) = {
        let db_state = app.state::<DbState>();
        let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
        let conn = match inner.conn.as_ref() {
            Some(c) => c,
            None => return Ok(None),
        };
        ensure_schema(conn)?;
        if meta_get(conn, "enabled")?.as_deref() != Some("1") {
            return Ok(None);
        }
        let db_id = meta_get(conn, "db_id")?.unwrap_or_default();
        let site_id = meta_get(conn, "site_id")?.unwrap_or_default();
        if db_id.is_empty() || site_id.is_empty() {
            return Ok(None);
        }
        (
            db_id,
            site_id,
            meta_get(conn, "transport")?.unwrap_or_default(),
            meta_get(conn, "endpoint")?.unwrap_or_default(),
            meta_get(conn, "token")?.unwrap_or_default(),
        )
    };
    let transport = make_transport(app, &kind, &endpoint, &token)?;
    Ok(Some((db_id, site_id, transport)))
}

/// Pushes pending local ops. The caller must not hold the SyncGate.
fn push_pending(
    app: &AppHandle,
    db_id: &str,
    site_id: &str,
    transport: &dyn Transport,
) -> Result<i64, String> {
    let (schema_key, pending) = {
        let db_state = app.state::<DbState>();
        let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
        let conn = inner.conn.as_ref().ok_or("No database connected")?;
        let schema_key = meta_get(conn, "schema_key")?
            .unwrap_or_else(|| compute_schema_key(conn).unwrap_or_default());
        let push_after = meta_get(conn, "push_after")?
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let pending = local_ops(conn, site_id, push_after)?;
        (schema_key, pending)
    };
    if pending.is_empty() {
        return Ok(0);
    }
    transport.push(db_id, site_id, &schema_key, &pending)?;
    if let Some(last) = pending.iter().map(|o| o.seq).max() {
        let db_state = app.state::<DbState>();
        let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
        if let Some(conn) = inner.conn.as_ref() {
            meta_set(conn, "push_after", &last.to_string())?;
        }
    }
    Ok(pending.len() as i64)
}

/// Pulls remote ops (long-polling when `wait_ms > 0`) and applies them.
/// The caller must not hold the SyncGate.
fn pull_and_apply(
    app: &AppHandle,
    db_id: &str,
    transport: &dyn Transport,
    wait_ms: u32,
) -> Result<i64, String> {
    let after = {
        let db_state = app.state::<DbState>();
        let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
        let conn = inner.conn.as_ref().ok_or("No database connected")?;
        meta_get(conn, "cursor")?.unwrap_or_default()
    };
    let (remote_ops, peers, server_schema) = transport.pull(db_id, &after, wait_ms)?;
    let server_schema = server_schema.trim();
    let applied = {
        let db_state = app.state::<DbState>();
        let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
        let conn = inner.conn.as_ref().ok_or("No database connected")?;
        let local_schema = meta_get(conn, "schema_key")?.unwrap_or_default().trim().to_string();
        if !local_schema.is_empty() && !server_schema.is_empty() && local_schema != server_schema {
            return Err(
                "Schema mismatch: this database has a different structure from the synced group. \
                 Use the same database template on all devices."
                    .into(),
            );
        }
        let applied = if remote_ops.is_empty() {
            0
        } else {
            apply_batch(conn, &remote_ops, &after)?
        };
        meta_set(conn, "peers", &serde_json::to_string(&peers).unwrap_or_default())?;
        meta_set(conn, "last_error", "")?;
        meta_set(conn, "last_sync", &now_iso())?;
        applied
    };
    if applied > 0 {
        let _ = app.emit("dbreader:synced", applied);
    }
    Ok(applied)
}

pub fn run_sync(app: &AppHandle) -> Result<SyncOutcome, String> {
    use crate::SyncGate;
    let gate = app.state::<SyncGate>();
    let _guard = gate.0.lock().map_err(|_| "Sync gate poisoned".to_string())?;

    let mut outcome = SyncOutcome::default();
    let Some((db_id, site_id, transport)) = config_and_transport(app)? else {
        return Ok(outcome);
    };
    outcome.pushed = push_pending(app, &db_id, &site_id, transport.as_ref())?;
    outcome.applied = pull_and_apply(app, &db_id, transport.as_ref(), 0)?;
    Ok(outcome)
}

pub fn background_sync(app: &AppHandle) {
    if let Err(e) = run_sync(app) {
        let db_state = app.state::<DbState>();
        let lock = db_state.inner.lock();
        if let Ok(inner) = lock {
            if let Some(conn) = inner.conn.as_ref() {
                let _ = meta_set(conn, "last_error", &e);
            }
        }
    }
}

// ---------- tauri commands ----------

fn no_db_status() -> SyncStatus {
    SyncStatus {
        db_open: false,
        enabled: false,
        site_id: String::new(),
        db_id: String::new(),
        transport: String::new(),
        endpoint: String::new(),
        token: String::new(),
        schema_key: String::new(),
        push_pending: 0,
        cursor: String::new(),
        peers: Vec::new(),
        synced_tables: Vec::new(),
        skipped_tables: Vec::new(),
        last_sync: None,
        last_error: None,
    }
}

fn with_open_conn<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let db_state = app.state::<DbState>();
    let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
    let conn = inner.conn.as_ref().ok_or("No database connected")?;
    f(conn)
}

#[tauri::command]
pub fn sync_status(app: AppHandle) -> Result<SyncStatus, String> {
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        status_from_conn(conn, true)
    })
    .or_else(|_| Ok(no_db_status()))
}

#[tauri::command]
pub fn sync_configure(
    transport: String,
    endpoint: String,
    token: String,
    db_id: String,
    app: AppHandle,
) -> Result<SyncStatus, String> {
    let db_id = db_id.trim().to_string();
    if db_id.is_empty() {
        return Err("Database sync ID is required".into());
    }
    if !is_plain_name(&db_id) {
        return Err("Sync ID may only contain letters, numbers and underscores".into());
    }
    if transport != "relay" && transport != "folder" {
        return Err("Unknown transport".into());
    }
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        let _site_id = site_id_or_create(conn)?;
        let schema_key = compute_schema_key(conn)?;
        meta_set(conn, "transport", &transport)?;
        meta_set(conn, "endpoint", &endpoint)?;
        meta_set(conn, "token", &token)?;
        meta_set(conn, "db_id", &db_id)?;
        meta_set(conn, "schema_key", &schema_key)?;
        meta_set(conn, "enabled", "1")?;
        status_from_conn(conn, true)
    })
}

#[tauri::command]
pub fn sync_disable(app: AppHandle) -> Result<SyncStatus, String> {
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        meta_set(conn, "enabled", "0")?;
        status_from_conn(conn, true)
    })
}

#[tauri::command]
pub fn sync_enable(app: AppHandle) -> Result<SyncStatus, String> {
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        if meta_get(conn, "db_id")?.unwrap_or_default().is_empty() {
            return Err("Configure a database sync ID first".into());
        }
        meta_set(conn, "enabled", "1")?;
        let mut status = status_from_conn(conn, true)?;
        status.enabled = true;
        Ok(status)
    })
}

#[tauri::command]
pub fn sync_now(app: AppHandle) -> Result<SyncStatus, String> {
    match run_sync(&app) {
        Ok(_) => {}
        Err(e) => {
            let _ = with_open_conn(&app, |conn| {
                meta_set(conn, "last_error", &e)?;
                Ok(())
            });
            return Err(e);
        }
    }
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        status_from_conn(conn, true)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    struct MemTransport {
        store: Arc<StdMutex<Vec<SyncOp>>>,
        schema: Arc<StdMutex<String>>,
        peers: Arc<StdMutex<Vec<String>>>,
    }

    impl Transport for MemTransport {
        fn push(
            &self,
            _db_id: &str,
            _site_id: &str,
            schema_key: &str,
            ops: &[SyncOp],
        ) -> Result<(), String> {
            let mut store = self.store.lock().map_err(|e| e.to_string())?;
            if !schema_key.is_empty() {
                *self.peers.lock().map_err(|e| e.to_string())? = ops
                    .iter()
                    .map(|o| o.site.clone())
                    .collect();
                let mut s = self.schema.lock().map_err(|e| e.to_string())?;
                if s.is_empty() {
                    *s = schema_key.to_string();
                }
            }
            for op in ops {
                if !store.iter().any(|o| o.site == op.site && o.seq == op.seq) {
                    store.push(op.clone());
                }
            }
            Ok(())
        }

        fn pull(
            &self,
            _db_id: &str,
            after: &str,
            _wait_ms: u32,
        ) -> Result<(Vec<SyncOp>, Vec<String>, String), String> {
            let store = self.store.lock().map_err(|e| e.to_string())?;
            let peers = self.peers.lock().map_err(|e| e.to_string())?.clone();
            let schema = self.schema.lock().map_err(|e| e.to_string())?.clone();
            let (ah, as_, aseq) = cursor_after(after);
            let mut ops: Vec<SyncOp> = store
                .iter()
                .filter(|op| {
                    op.hlc > ah
                        || (op.hlc == ah
                            && (op.site > as_ || (op.site == as_ && op.seq > aseq)))
                })
                .cloned()
                .collect();
            ops.sort_by(|a, b| {
                (a.hlc.as_str(), a.site.as_str(), a.seq)
                    .cmp(&(b.hlc.as_str(), b.site.as_str(), b.seq))
            });
            Ok((ops, peers, schema))
        }
    }

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(crate::INVENTORY_SCHEMA).unwrap();
        conn.execute_batch(crate::SEED_DATA).unwrap();
        conn
    }

    fn pull_loop(conn: &Connection, _site: &str, mem: &MemTransport) -> i64 {
        let mut applied_total = 0i64;
        loop {
            let after = meta_get(conn, "cursor").unwrap().unwrap_or_default();
            let (ops, peers, schema) = mem.pull("dbtest", &after, 0).unwrap();
            let local_schema = meta_get(conn, "schema_key").unwrap().unwrap_or_default();
            if !local_schema.is_empty() && !schema.is_empty() && local_schema != schema {
                panic!("schema mismatch");
            }
            meta_set(conn, "peers", &serde_json::to_string(&peers).unwrap()).unwrap();
            if ops.is_empty() {
                break;
            }
            let applied = apply_batch(conn, &ops, &after).unwrap();
            applied_total += applied;
        }
        applied_total
    }

    fn push_all(conn: &Connection, mem: &MemTransport, db_id: &str, site: &str) -> i64 {
        let schema = meta_get(conn, "schema_key").unwrap().unwrap_or_default();
        let mut total = 0i64;
        loop {
            let push_after = meta_get(conn, "push_after").unwrap().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            let ops = local_ops(conn, site, push_after).unwrap();
            if ops.is_empty() {
                break;
            }
            mem.push(db_id, site, &schema, &ops).unwrap();
            let last = ops.iter().map(|o| o.seq).max().unwrap();
            meta_set(conn, "push_after", &last.to_string()).unwrap();
            total += ops.len() as i64;
        }
        total
    }

    fn sync_all(mem: &MemTransport, conns: &[&Connection], db_id: &str) {
        for conn in conns {
            let site = site_id_or_create(conn).unwrap();
            push_all(conn, mem, db_id, &site);
        }
        for conn in conns {
            let site = site_id_or_create(conn).unwrap();
            pull_loop(conn, &site, mem);
        }
    }

    #[test]
    fn test_sync_row_propagates() {
        let mem = MemTransport {
            store: Arc::new(StdMutex::new(Vec::new())),
            peers: Arc::new(StdMutex::new(Vec::new())),
            schema: Arc::new(StdMutex::new(String::new())),
        };
        let a = setup_db();
        let b = setup_db();
        ensure_schema(&a).unwrap();
        ensure_schema(&b).unwrap();
        ensure_triggers(&a).unwrap();
        ensure_triggers(&b).unwrap();
        let sa = site_id_or_create(&a).unwrap();
        let sb = site_id_or_create(&b).unwrap();
        let ka = compute_schema_key(&a).unwrap();
        let kb = compute_schema_key(&b).unwrap();
        assert_eq!(ka, kb);
        meta_set(&a, "schema_key", &ka).unwrap();
        meta_set(&b, "schema_key", &kb).unwrap();
        a.execute(
            "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Synced Wine', 'SYN-001', 'bottle', 2)",
            [],
        )
        .unwrap();
        sync_all(&mem, &[&a, &b], "dbtest");
        let name: String = b
            .query_row("SELECT name FROM products WHERE sku = 'SYN-001'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "Synced Wine");
        let _ = (sa, sb);
    }

    #[test]
    fn test_concurrent_edits_converge() {
        let mem = MemTransport {
            store: Arc::new(StdMutex::new(Vec::new())),
            peers: Arc::new(StdMutex::new(Vec::new())),
            schema: Arc::new(StdMutex::new(String::new())),
        };
        let a = setup_db();
        let b = setup_db();
        ensure_schema(&a).unwrap();
        ensure_schema(&b).unwrap();
        ensure_triggers(&a).unwrap();
        ensure_triggers(&b).unwrap();
        let sa = site_id_or_create(&a).unwrap();
        let sb = site_id_or_create(&b).unwrap();
        let ka = compute_schema_key(&a).unwrap();
        meta_set(&a, "schema_key", &ka).unwrap();
        meta_set(&b, "schema_key", &ka).unwrap();
        let _ = (sa, sb);

        a.execute("UPDATE products SET reorder_threshold = 42 WHERE id = 1", []).unwrap();
        b.execute("UPDATE products SET reorder_threshold = 99 WHERE id = 1", []).unwrap();
        sync_all(&mem, &[&a, &b], "dbtest");
        let va: f64 = a.query_row("SELECT reorder_threshold FROM products WHERE id = 1", [], |r| r.get(0)).unwrap();
        let vb: f64 = b.query_row("SELECT reorder_threshold FROM products WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(va, vb);
    }

    #[test]
    fn test_field_merge_keeps_both_edits() {
        let mem = MemTransport {
            store: Arc::new(StdMutex::new(Vec::new())),
            peers: Arc::new(StdMutex::new(Vec::new())),
            schema: Arc::new(StdMutex::new(String::new())),
        };
        let a = setup_db();
        let b = setup_db();
        ensure_schema(&a).unwrap();
        ensure_schema(&b).unwrap();
        ensure_triggers(&a).unwrap();
        ensure_triggers(&b).unwrap();
        let sa = site_id_or_create(&a).unwrap();
        let sb = site_id_or_create(&b).unwrap();
        let ka = compute_schema_key(&a).unwrap();
        meta_set(&a, "schema_key", &ka).unwrap();
        meta_set(&b, "schema_key", &ka).unwrap();
        let _ = (sa, sb);

        a.execute(
            "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Wine', 'MRG-001', 'bottle', 2)",
            [],
        )
        .unwrap();
        sync_all(&mem, &[&a, &b], "dbtest");

        a.execute("UPDATE products SET reorder_threshold = 42 WHERE sku = 'MRG-001'", []).unwrap();
        b.execute("UPDATE products SET name = 'Renamed Wine' WHERE sku = 'MRG-001'", []).unwrap();
        sync_all(&mem, &[&a, &b], "dbtest");

        for (conn, label) in [(&a, "A"), (&b, "B")] {
            let (name, threshold): (String, f64) = conn
                .query_row(
                    "SELECT name, reorder_threshold FROM products WHERE sku = 'MRG-001'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(name, "Renamed Wine", "{} name", label);
            assert_eq!(threshold, 42.0, "{} threshold", label);
        }
    }

    #[test]
    fn test_delete_propagates() {
        let mem = MemTransport {
            store: Arc::new(StdMutex::new(Vec::new())),
            peers: Arc::new(StdMutex::new(Vec::new())),
            schema: Arc::new(StdMutex::new(String::new())),
        };
        let a = setup_db();
        let b = setup_db();
        ensure_schema(&a).unwrap();
        ensure_schema(&b).unwrap();
        ensure_triggers(&a).unwrap();
        ensure_triggers(&b).unwrap();
        let sa = site_id_or_create(&a).unwrap();
        let sb = site_id_or_create(&b).unwrap();
        let ka = compute_schema_key(&a).unwrap();
        meta_set(&a, "schema_key", &ka).unwrap();
        meta_set(&b, "schema_key", &ka).unwrap();
        let _ = (sa, sb);
        a.execute("DELETE FROM unit_conversions WHERE id = 1", []).unwrap();
        sync_all(&mem, &[&a, &b], "dbtest");
        let n: i64 = b
            .query_row("SELECT COUNT(*) FROM unit_conversions WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn test_relay_http_roundtrip() {
        use std::time::{Duration, Instant};

        let root = std::env::temp_dir().join(format!("dbreader-relay-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let relay = Arc::new(dbreader_relay::Relay::new(root.clone(), Some("secret".into())).unwrap());
        let relay2 = relay.clone();
        let port: u16 = 18_991;
        let server = std::thread::spawn(move || {
            let _ = dbreader_relay::serve(&relay2, port);
        });

        let endpoint = format!("http://127.0.0.1:{port}");
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let up = ureq::config::Config::builder()
                .build()
                .new_agent()
                .get(&format!("{endpoint}/health"))
                .header("Authorization", "Bearer secret")
                .call()
                .is_ok();
            if up {
                break;
            }
            assert!(Instant::now() < deadline, "relay did not start in time");
            std::thread::sleep(Duration::from_millis(50));
        }

        let conn = setup_db();
        ensure_schema(&conn).unwrap();
        ensure_triggers(&conn).unwrap();
        let site = site_id_or_create(&conn).unwrap();
        conn.execute(
            "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Merlot', 'MRL-001', 'bottle', 4)",
            [],
        )
        .unwrap();
        let ops = local_ops(&conn, &site, 0).unwrap();
        assert!(!ops.is_empty());
        let schema = compute_schema_key(&conn).unwrap();
        meta_set(&conn, "schema_key", &schema).unwrap();
        assert!(!schema.is_empty());

        let transport = RelayTransport { endpoint: endpoint.clone(), token: "secret".into() };
        transport.push("dbtest", &site, &schema, &ops).unwrap();

        let (pulled, peers, schema_out) = transport.pull("dbtest", "", 0).unwrap();
        assert_eq!(pulled.len(), ops.len());
        assert_eq!(peers, vec![site.clone()]);
        assert_eq!(schema_out, schema);
        let mut expected: Vec<&SyncOp> = ops.iter().collect();
        let mut actual: Vec<&SyncOp> = pulled.iter().collect();
        expected.sort_by_key(|o| (o.hlc.clone(), o.site.clone(), o.seq));
        actual.sort_by_key(|o| (o.hlc.clone(), o.site.clone(), o.seq));
        for (e, a) in expected.iter().zip(actual.iter()) {
            assert_eq!(e.table, a.table);
            assert_eq!(e.op, a.op);
            assert_eq!(e.pk, a.pk);
            assert_eq!(e.pk_json_raw, a.pk_json_raw);
            assert_eq!(e.row, a.row);
            assert_eq!(e.hlc, a.hlc);
            assert_eq!(e.seq, a.seq);
        }

        let bad = RelayTransport { endpoint: endpoint.clone(), token: "nope".into() };
        assert!(bad.push("dbtest", &site, &schema, &ops).is_err());
        assert!(bad.pull("dbtest", "", 0).is_err());

        drop(server);
        let _ = std::fs::remove_dir_all(root);
    }
}