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
    pub cloud_email: String,
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
    if table_exists(conn, "batches")? {
        let cols: Vec<String> = table_columns(conn, "batches")?.into_iter().map(|(c, _)| c).collect();
        if !cols.iter().any(|c| c == "is_removed") {
            conn.execute_batch("ALTER TABLE batches ADD COLUMN is_removed INTEGER DEFAULT 0")
                .map_err(|e| format!("Failed to migrate batches table: {}", e))?;
        }
    }
    let key = compute_schema_key(conn)?;
    if meta_get(conn, "schema_key")?.as_deref() != Some(key.as_str()) {
        meta_set(conn, "schema_key", &key)?;
    }
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
    let tables = user_tables(conn)?;
    let mut hasher = Sha256::new();
    for table in &tables {
        hasher.update(table.as_bytes());
        hasher.update(b"\n");
        let mut cols: Vec<String> = table_columns(conn, table)?
            .into_iter()
            .map(|(c, _)| c)
            .collect();
        cols.sort();
        for c in cols {
            hasher.update(c.as_bytes());
            hasher.update(b"\n");
        }
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

pub(crate) trait Transport: Send {
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
    team_id: String,
    file_id: String,
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
        let mut body = serde_json::json!({
            "site": site_id,
            "schema": schema_key,
            "ops": ops,
        });
        if !self.team_id.is_empty() {
            body["team_id"] = self.team_id.clone().into();
            body["file_id"] = self.file_id.clone().into();
        } else {
            body["db"] = db_id.into();
        }
        let mut req = user_agent().post(&url);
        if !self.token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.token));
        }
        let mut resp = req
            .send_json(&body)
            .map_err(|e| format!("Relay push failed: {}", e))?;
        if resp.status() != 200 {
            let detail = resp
                .body_mut()
                .read_to_string()
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect::<String>();
            return Err(format!(
                "Relay push returned status {}: {}",
                resp.status(),
                detail
            ));
        }
        Ok(())
    }

    fn pull(&self, db_id: &str, after: &str, wait_ms: u32) -> Result<(Vec<SyncOp>, Vec<String>, String), String> {
        let (h, site, seq) = cursor_after(after);
        // Keep the server-side wait under the client's 15s global timeout.
        let wait_ms = wait_ms.min(12_000);
        let base = self.endpoint.trim_end_matches('/');
        let url = if !self.team_id.is_empty() {
            format!(
                "{}/api/v1/pull?team_id={}&file_id={}&site={}&h={}&seq={}&wait={}",
                base, self.team_id, self.file_id, site, h, seq, wait_ms
            )
        } else {
            format!(
                "{}/api/v1/pull?db={}&h={}&site={}&seq={}&wait={}",
                base, db_id, h, site, seq, wait_ms
            )
        };
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
    team_id: &str,
    file_id: &str,
) -> Result<Box<dyn Transport>, String> {
    match kind {
        "relay" => {
            if endpoint.trim().is_empty() {
                return Err("Relay endpoint is not set".into());
            }
            Ok(Box::new(RelayTransport {
                endpoint: endpoint.trim().to_string(),
                token: token.trim().to_string(),
                team_id: team_id.trim().to_string(),
                file_id: file_id.trim().to_string(),
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

// ---------- cloud bootstrap ----------

/// Minimal client for the DBReader cloud API (deploy/cloud-relay). Used to
/// provision the device account, team and published file the sync engine
/// needs before the regular push/pull flow can run.
struct CloudApi {
    endpoint: String,
}

impl CloudApi {
    fn new(endpoint: &str) -> Result<CloudApi, String> {
        if endpoint.trim().is_empty() {
            return Err("Relay endpoint is not set".into());
        }
        Ok(CloudApi {
            endpoint: endpoint.trim_end_matches('/').to_string(),
        })
    }

    fn post_json(&self, path: &str, body: serde_json::Value, token: &str) -> Result<serde_json::Value, String> {
        let mut req = user_agent().post(&format!("{}{}", self.endpoint, path));
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        let resp = req.send_json(&body).map_err(|e| format!("cloud {} failed: {}", path, e))?;
        if resp.status() != 200 {
            return Err(format!("cloud {} returned status {}", path, resp.status()));
        }
        resp.into_body()
            .read_json()
            .map_err(|e| format!("cloud {} returned invalid JSON: {}", path, e))
    }

    fn get_json(&self, path: &str, token: &str) -> Result<serde_json::Value, String> {
        let mut req = user_agent().get(&format!("{}{}", self.endpoint, path));
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        let resp = req.call().map_err(|e| format!("cloud {} failed: {}", path, e))?;
        if resp.status() != 200 {
            return Err(format!("cloud {} returned status {}", path, resp.status()));
        }
        resp.into_body()
            .read_json()
            .map_err(|e| format!("cloud {} returned invalid JSON: {}", path, e))
    }

    /// Registers a device account, or logs in when the account already exists.
    fn ensure_account(&self, email: &str, password: &str) -> Result<String, String> {
        let token = self
            .post_json(
                "/api/v1/register",
                serde_json::json!({ "email": email, "name": "Device", "password": password }),
                "",
            )
            .and_then(|v| {
                v.get("token")
                    .and_then(|t| t.as_str())
                    .map(String::from)
                    .ok_or_else(|| "register response missing token".to_string())
            });
        match token {
            Ok(t) => Ok(t),
            Err(e) if e.contains("409") => {
                let v = self.post_json(
                    "/api/v1/login",
                    serde_json::json!({ "email": email, "password": password }),
                    "",
                )?;
                v.get("token")
                    .and_then(|t| t.as_str())
                    .map(String::from)
                    .ok_or_else(|| "login response missing token".to_string())
            }
            Err(e) => Err(e),
        }
    }

    fn create_team(&self, token: &str, name: &str) -> Result<String, String> {
        let v = self.post_json(
            "/api/v1/team/create",
            serde_json::json!({ "name": name }),
            token,
        )?;
        v.get("team_id")
            .and_then(|t| t.as_str())
            .map(String::from)
            .ok_or_else(|| "team create response missing team_id".to_string())
    }

    fn join_team(&self, token: &str, code: &str) -> Result<String, String> {
        let v = self.post_json(
            "/api/v1/team/join",
            serde_json::json!({ "code": code }),
            token,
        )?;
        v.get("team_id")
            .and_then(|t| t.as_str())
            .map(String::from)
            .ok_or_else(|| "team join response missing team_id".to_string())
    }

    /// Picks the most recently published file in the team. A team created by
    /// the app holds exactly one database, so this is unambiguous in practice.
    fn latest_file(&self, token: &str, team_id: &str) -> Result<String, String> {
        let v = self.get_json(&format!("/api/v1/files?team_id={}", team_id), token)?;
        let files = v.get("files").and_then(|f| f.as_array()).ok_or_else(|| "files response missing list".to_string())?;
        files
            .iter()
            .filter_map(|f| {
                let id = f.get("file_id").and_then(|x| x.as_str())?.to_string();
                let ts = f.get("created_ts").and_then(|x| x.as_i64()).unwrap_or(0);
                Some((id, ts))
            })
            .max_by_key(|(_, ts)| *ts)
            .map(|(id, _)| id)
            .ok_or_else(|| {
                "No database file in this team yet — publish it from the owning device first".into()
            })
    }

    /// Looks up every team of the signed-in account and returns the team + file
    /// pair for this database (matched by its auto-generated file name). Lets
    /// the same account reconnect to its own databases on other devices without
    /// an invite code.
    fn find_file_for_db(&self, token: &str, db_id: &str) -> Result<Option<(String, String)>, String> {
        let v = self.get_json("/api/v1/me", token)?;
        let teams = v
            .get("teams")
            .and_then(|t| t.as_array())
            .ok_or_else(|| "me response missing teams".to_string())?;
        let target = format!("{}.db", db_id);
        let mut best: Option<(String, String, i64)> = None;
        for t in teams {
            let Some(team_id) = t.get("team_id").and_then(|x| x.as_str()) else {
                continue;
            };
            let files_v = self.get_json(&format!("/api/v1/files?team_id={}", team_id), token)?;
            let files: Vec<serde_json::Value> = files_v
                .get("files")
                .and_then(|f| f.as_array())
                .cloned()
                .unwrap_or_default();
            for f in &files {
                let Some(file_id) = f.get("file_id").and_then(|x| x.as_str()) else {
                    continue;
                };
                let name = f.get("name").and_then(|x| x.as_str()).unwrap_or("");
                let ts = f.get("created_ts").and_then(|x| x.as_i64()).unwrap_or(0);
                if name == target && best.as_ref().map_or(true, |(_, _, b)| ts > *b) {
                    best = Some((team_id.to_string(), file_id.to_string(), ts));
                }
            }
        }
        Ok(best.map(|(t, f, _)| (t, f)))
    }

    /// Returns the invite code for this team (owners only; refreshes the code
    /// server-side when the previous one expired).
    fn invite_code(&self, token: &str, team_id: &str) -> Result<String, String> {
        let v = self.get_json("/api/v1/me", token)?;
        let teams = v.get("teams").and_then(|t| t.as_array()).ok_or_else(|| "me response missing teams".to_string())?;
        for t in teams {
            if t.get("team_id").and_then(|x| x.as_str()) == Some(team_id) {
                if let Some(c) = t.get("code").and_then(|x| x.as_str()) {
                    return Ok(c.to_string());
                }
            }
        }
        Err("Invite code unavailable — only the team creator can get it".into())
    }

    /// Publishes a new (empty) database file and returns its file_id.
    fn publish_file(&self, token: &str, team_id: &str, name: &str) -> Result<String, String> {
        let v = self.post_json(
            "/api/v1/files/upload-url",
            serde_json::json!({ "team_id": team_id, "name": name }),
            token,
        )?;
        let file_id = v
            .get("file_id")
            .and_then(|t| t.as_str())
            .map(String::from)
            .ok_or_else(|| "upload-url response missing file_id".to_string())?;
        let upload_url = v
            .get("upload_url")
            .and_then(|t| t.as_str())
            .map(String::from)
            .ok_or_else(|| "upload-url response missing upload_url".to_string())?;
        let put = user_agent()
            .put(&upload_url)
            .send("x")
            .map_err(|e| format!("S3 upload failed: {}", e))?;
        if put.status() != 200 {
            return Err(format!("S3 upload returned status {}", put.status()));
        }
        self.post_json(
            "/api/v1/files/confirm",
            serde_json::json!({ "team_id": team_id, "file_id": file_id, "size": 1 }),
            token,
        )?;
        Ok(file_id)
    }
}

/// Provisions (or reuses) the cloud session/team/file for the current database
/// and persists the resulting ids into sync meta. Returns an error message the
/// UI can display when the cloud is unreachable or misconfigured.
fn ensure_cloud_session(conn: &Connection, endpoint: &str, db_id: &str, site_id: &str, token: &str) -> Result<(), String> {
    let api = CloudApi::new(endpoint)?;
    let email = meta_get(conn, "cloud_email")?
        .filter(|e| !e.trim().is_empty())
        .unwrap_or_else(|| format!("device-{}@dbreader.dev", site_id));
    let password = meta_get(conn, "cloud_pass")?.unwrap_or_default();
    if password.len() < 8 {
        return Err("Cloud provisioning needs a stored device password".into());
    }
    let session_token = if token.trim().is_empty() {
        api.ensure_account(&email, &password)?
    } else {
        token.trim().to_string()
    };
    let team_id = meta_get(conn, "cloud_team_id")?.unwrap_or_default();
    let file_id = meta_get(conn, "cloud_file_id")?.unwrap_or_default();
    let team_id = if team_id.is_empty() {
        api.create_team(&session_token, db_id)?
    } else {
        team_id
    };
    let file_id = if file_id.is_empty() {
        api.publish_file(&session_token, &team_id, &format!("{}.db", db_id))?
    } else {
        file_id
    };
    meta_set(conn, "token", &session_token)?;
    meta_set(conn, "cloud_team_id", &team_id)?;
    meta_set(conn, "cloud_file_id", &file_id)?;
    Ok(())
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
        cloud_email: meta_get(conn, "cloud_email")?.unwrap_or_default(),
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

/// The DBReader cloud backend. The app connects to it automatically; users
/// never see or configure this. Override with DBREADER_CLOUD_ENDPOINT for
/// development or a self-hosted backend.
pub const CLOUD_ENDPOINT: &str = "https://y0nzvgypjb.execute-api.ap-southeast-2.amazonaws.com";

fn cloud_endpoint() -> String {
    std::env::var("DBREADER_CLOUD_ENDPOINT").unwrap_or_else(|_| CLOUD_ENDPOINT.to_string())
}

/// The logical sync id for this database. Auto-generated once per database and
/// stored in its sync meta; used as the team name and published file name.
fn db_id_or_create(conn: &Connection) -> Result<String, String> {
    if let Some(s) = meta_get(conn, "db_id")? {
        return Ok(s);
    }
    let id = format!("db-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    meta_set(conn, "db_id", &id)?;
    Ok(id)
}

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

pub(crate) fn config_and_transport(app: &AppHandle) -> Result<Option<(String, String, Box<dyn Transport>)>, String> {
    let (db_id, site_id, kind, endpoint, token, cloud_team_id, cloud_file_id) = {
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
            meta_get(conn, "cloud_team_id")?.unwrap_or_default(),
            meta_get(conn, "cloud_file_id")?.unwrap_or_default(),
        )
    };
    let transport = make_transport(app, &kind, &endpoint, &token, &cloud_team_id, &cloud_file_id)?;
    Ok(Some((db_id, site_id, transport)))
}

/// Pushes pending local ops. The caller must not hold the SyncGate.
///
/// Tries the full pending batch first; if the transport rejects it, retries
/// one op at a time so a single bad batch does not stall every later op.
/// `push_after` advances only past ops the transport accepted, and
/// `last_error` is cleared only when at least one op was pushed.
pub(crate) fn push_pending(
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

    let (pushed, last_seq) =
        push_ops_with_fallback(transport, db_id, site_id, &schema_key, &pending)?;
    if pushed > 0 {
        advance_push_state(app, last_seq)?;
    }
    Ok(pushed)
}

/// Tries the full pending batch first; if the transport rejects a multi-op
/// batch, retries one op at a time so a single bad op does not stall later
/// ones. Returns `(pushed_count, highest_seq_accepted)` or the original
/// batch error when nothing could be pushed.
fn push_ops_with_fallback(
    transport: &dyn Transport,
    db_id: &str,
    site_id: &str,
    schema_key: &str,
    pending: &[SyncOp],
) -> Result<(i64, i64), String> {
    match transport.push(db_id, site_id, schema_key, pending) {
        Ok(()) => {
            let last = pending.iter().map(|o| o.seq).max().unwrap_or(0);
            Ok((pending.len() as i64, last))
        }
        Err(first) if pending.len() > 1 => {
            let mut pushed = 0i64;
            let mut last_seq = 0i64;
            for op in pending {
                match transport.push(db_id, site_id, schema_key, std::slice::from_ref(op)) {
                    Ok(()) => {
                        pushed += 1;
                        last_seq = op.seq;
                    }
                    Err(_) => break,
                }
            }
            if pushed == 0 {
                Err(first)
            } else {
                Ok((pushed, last_seq))
            }
        }
        Err(e) => Err(e),
    }
}

/// Records the highest accepted seq into `push_after` and clears the stored
/// sync error, since at least the ops up to `seq` have left this device.
fn advance_push_state(app: &AppHandle, seq: i64) -> Result<(), String> {
    let db_state = app.state::<DbState>();
    let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(conn) = inner.conn.as_ref() {
        meta_set(conn, "push_after", &seq.to_string())?;
        meta_set(conn, "last_error", "")?;
    }
    Ok(())
}

/// A batch of remote ops fetched by [`pull_remote`].
pub(crate) struct Pulled {
    pub after: String,
    pub ops: Vec<SyncOp>,
    pub peers: Vec<String>,
    pub schema: String,
}

/// Fetches remote ops (long-polling when `wait_ms > 0`). Does not touch the DB
/// beyond reading the cursor, so it must not hold the SyncGate.
pub(crate) fn pull_remote(
    app: &AppHandle,
    db_id: &str,
    transport: &dyn Transport,
    wait_ms: u32,
) -> Result<Pulled, String> {
    let after = {
        let db_state = app.state::<DbState>();
        let inner = db_state.inner.lock().map_err(|e| e.to_string())?;
        let conn = inner.conn.as_ref().ok_or("No database connected")?;
        meta_get(conn, "cursor")?.unwrap_or_default()
    };
    let (ops, peers, schema) = transport.pull(db_id, &after, wait_ms)?;
    Ok(Pulled { after, ops, peers, schema })
}

/// Applies a batch of remote ops. The caller must hold the SyncGate.
pub(crate) fn apply_remote(app: &AppHandle, pulled: Pulled) -> Result<i64, String> {
    let server_schema = pulled.schema.trim().to_string();
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
        let live = app.state::<std::sync::Arc<crate::sync_live::LiveSync>>();
        live.applying.store(true, std::sync::atomic::Ordering::Relaxed);
        let result = if pulled.ops.is_empty() {
            Ok(0)
        } else {
            apply_batch(conn, &pulled.ops, &pulled.after)
        };
        live.applying.store(false, std::sync::atomic::Ordering::Relaxed);
        let applied = result?;
        meta_set(conn, "peers", &serde_json::to_string(&pulled.peers).unwrap_or_default())?;
        // Only a successful apply (or a successful push elsewhere) clears the
        // stored error; an empty pull must not hide a failing push.
        if applied > 0 {
            meta_set(conn, "last_error", "")?;
        }
        meta_set(conn, "last_sync", &now_iso())?;
        applied
    };
    if applied > 0 {
        let _ = app.emit("dbreader:synced", applied);
    }
    Ok(applied)
}

/// Pulls remote ops (long-polling when `wait_ms > 0`) and applies them.
/// The caller must hold the SyncGate.
fn pull_and_apply(
    app: &AppHandle,
    db_id: &str,
    transport: &dyn Transport,
    wait_ms: u32,
) -> Result<i64, String> {
    let pulled = pull_remote(app, db_id, transport, wait_ms)?;
    apply_remote(app, pulled)
}

/// Records a sync error into the database meta so the UI can display it.
pub(crate) fn record_last_error(app: &AppHandle, err: &str) {
    let db_state = app.state::<DbState>();
    let lock = db_state.inner.lock();
    if let Ok(inner) = lock {
        if let Some(conn) = inner.conn.as_ref() {
            let _ = meta_set(conn, "last_error", err);
        }
    }
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
        cloud_email: String::new(),
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

/// Provisions the cloud connection for the open database (device account,
/// team, published file) when needed. Idempotent — reuses stored ids.
fn ensure_cloud_connected(conn: &Connection) -> Result<(), String> {
    ensure_schema(conn)?;
    let site_id = site_id_or_create(conn)?;
    let db_id = db_id_or_create(conn)?;
    if meta_get(conn, "cloud_pass")?.is_none() {
        let pass = format!("{:x}", uuid::Uuid::new_v4().simple());
        meta_set(conn, "cloud_pass", &pass)?;
    }
    let endpoint = cloud_endpoint();
    ensure_cloud_session(conn, &endpoint, &db_id, &site_id, "")?;
    let schema_key = compute_schema_key(conn)?;
    meta_set(conn, "transport", "relay")?;
    meta_set(conn, "endpoint", &endpoint)?;
    meta_set(conn, "schema_key", &schema_key)?;
    Ok(())
}

#[tauri::command]
pub fn sync_disable(app: AppHandle) -> Result<SyncStatus, String> {
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        meta_set(conn, "enabled", "0")?;
        status_from_conn(conn, true)
    })
}

/// Enables cloud sync for the open database, provisioning the device account,
/// team and published file automatically on first use.
#[tauri::command]
pub fn sync_enable(app: AppHandle) -> Result<SyncStatus, String> {
    with_open_conn(&app, |conn| {
        ensure_cloud_connected(conn)?;
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

/// Joins an existing cloud team with the owner's 8-character invite code and
/// links this device to the database file the owner published.
#[tauri::command]
pub fn sync_join(code: String, app: AppHandle) -> Result<SyncStatus, String> {
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        let _db_id = db_id_or_create(conn)?;
        let site_id = site_id_or_create(conn)?;
        if meta_get(conn, "cloud_pass")?.is_none() {
            let pass = format!("{:x}", uuid::Uuid::new_v4().simple());
            meta_set(conn, "cloud_pass", &pass)?;
        }
        let endpoint = cloud_endpoint();
        let api = CloudApi::new(&endpoint)?;
        let email = meta_get(conn, "cloud_email")?
            .filter(|e| !e.trim().is_empty())
            .unwrap_or_else(|| format!("device-{}@dbreader.dev", site_id));
        let password = meta_get(conn, "cloud_pass")?.unwrap_or_default();
        if password.len() < 8 {
            return Err("No account configured — enable sync or sign in first".into());
        }
        let token = api.ensure_account(&email, &password)?;
        let team_id = api.join_team(&token, code.trim())?;
        let file_id = api.latest_file(&token, &team_id)?;
        meta_set(conn, "token", &token)?;
        meta_set(conn, "cloud_team_id", &team_id)?;
        meta_set(conn, "cloud_file_id", &file_id)?;
        meta_set(conn, "transport", "relay")?;
        meta_set(conn, "endpoint", &endpoint)?;
        meta_set(conn, "enabled", "1")?;
        status_from_conn(conn, true)
    })
}

/// Returns the current invite code (owners only) so the UI can display it to
/// another device.
#[tauri::command]
pub fn sync_invite_code(app: AppHandle) -> Result<String, String> {
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        let endpoint = cloud_endpoint();
        let team_id = meta_get(conn, "cloud_team_id")?.unwrap_or_default();
        let token = meta_get(conn, "token")?.unwrap_or_default();
        if team_id.is_empty() || token.is_empty() {
            return Err("No cloud team configured yet".into());
        }
        CloudApi::new(&endpoint)?.invite_code(&token, &team_id)
    })
}

/// Links an open database to a personal account: creates the team + published
/// file under the account on first use, or reconnects to the existing one.
fn connect_db_to_account(conn: &Connection, email: &str, password: &str) -> Result<(), String> {
    ensure_schema(conn)?;
    let db_id = db_id_or_create(conn)?;
    let endpoint = cloud_endpoint();
    let has_link = meta_get(conn, "cloud_team_id")?.map(|t| !t.is_empty()).unwrap_or(false)
        && meta_get(conn, "cloud_file_id")?.map(|f| !f.is_empty()).unwrap_or(false)
        && meta_get(conn, "token")?.map(|t| !t.is_empty()).unwrap_or(false);
    if has_link && meta_get(conn, "endpoint")?.map(|e| e == endpoint).unwrap_or(false) {
        let api = CloudApi::new(&endpoint)?;
        let token = api.ensure_account(email, password)?;
        meta_set(conn, "cloud_email", email)?;
        meta_set(conn, "cloud_pass", password)?;
        meta_set(conn, "token", &token)?;
        return Ok(());
    }
    let api = CloudApi::new(&endpoint)?;
    let token = api.ensure_account(email, password)?;
    meta_set(conn, "cloud_email", email)?;
    meta_set(conn, "cloud_pass", password)?;
    meta_set(conn, "token", &token)?;
    match api.find_file_for_db(&token, &db_id)? {
        Some((team_id, file_id)) => {
            meta_set(conn, "cloud_team_id", &team_id)?;
            meta_set(conn, "cloud_file_id", &file_id)?;
        }
        None => {
            let team_id = api.create_team(&token, &db_id)?;
            let file_id = api.publish_file(&token, &team_id, &format!("{}.db", db_id))?;
            meta_set(conn, "cloud_team_id", &team_id)?;
            meta_set(conn, "cloud_file_id", &file_id)?;
        }
    }
    meta_set(conn, "transport", "relay")?;
    meta_set(conn, "endpoint", &endpoint)?;
    meta_set(conn, "enabled", "1")?;
    Ok(())
}

/// Signs in with a personal account. The account is created automatically on
/// first use; on later devices it reconnects to this database directly (via
/// the shared file name) without an invite code.
#[tauri::command]
pub fn sync_signin(email: String, password: String, app: AppHandle) -> Result<SyncStatus, String> {
    let email = email.trim().to_string();
    if email.len() < 3 || !email.contains('@') {
        return Err("Enter a valid email address".into());
    }
    if password.len() < 8 {
        return Err("Password must be at least 8 characters".into());
    }
    with_open_conn(&app, |conn| {
        connect_db_to_account(conn, &email, &password)?;
        status_from_conn(conn, true)
    })
}

/// Signs out of the personal account: drops the stored credentials and the
/// cloud link, leaving the database ready for a fresh connect or join.
#[tauri::command]
pub fn sync_signout(app: AppHandle) -> Result<SyncStatus, String> {
    with_open_conn(&app, |conn| {
        ensure_schema(conn)?;
        meta_set(conn, "cloud_email", "")?;
        meta_set(conn, "cloud_pass", "")?;
        meta_set(conn, "token", "")?;
        meta_set(conn, "cloud_team_id", "")?;
        meta_set(conn, "cloud_file_id", "")?;
        meta_set(conn, "enabled", "0")?;
        status_from_conn(conn, true)
    })
}

// ---------- personal account (app-level) ----------

/// The app-level personal account. Stored once per device in the app config
/// directory (outside any database) so the app can require a sign-in before
/// databases are opened and connect every database to the same account.
#[derive(Serialize, Deserialize)]
struct StoredAccount {
    email: String,
    password: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub email: String,
}

const ACCOUNT_FILE: &str = "account.json";

fn account_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|d| d.join(ACCOUNT_FILE))
        .unwrap_or_else(|_| PathBuf::from(ACCOUNT_FILE))
}

fn account_load(app: &AppHandle) -> Option<StoredAccount> {
    let s = std::fs::read_to_string(account_path(app)).ok()?;
    serde_json::from_str(&s).ok()
}

fn account_save(app: &AppHandle, account: &StoredAccount) -> Result<(), String> {
    let path = account_path(app);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, serde_json::to_string(account).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Returns the signed-in account email, or an empty string when the app is not
/// signed in. Works without an open database.
#[tauri::command]
pub fn account_status(app: AppHandle) -> Result<AccountStatus, String> {
    Ok(AccountStatus {
        email: account_load(&app).map(|a| a.email).unwrap_or_default(),
    })
}

/// Signs in to (or registers) the personal account and stores it for this
/// device. The account is created automatically on first use.
#[tauri::command]
pub fn account_signin(
    email: String,
    password: String,
    app: AppHandle,
) -> Result<AccountStatus, String> {
    let email = email.trim().to_string();
    if email.len() < 3 || !email.contains('@') {
        return Err("Enter a valid email address".into());
    }
    if password.len() < 8 {
        return Err("Password must be at least 8 characters".into());
    }
    let api = CloudApi::new(&cloud_endpoint())?;
    let token = api.ensure_account(&email, &password)?;
    account_save(
        &app,
        &StoredAccount {
            email: email.clone(),
            password,
            token,
        },
    )?;
    if let Ok(status) = sync_status(app.clone()) {
        if status.db_open {
            auto_connect_account(&app);
        }
    }
    Ok(AccountStatus { email })
}

/// Signs out of the personal account on this device. Databases keep their
/// local data; signing in again on another account reconnects them there.
#[tauri::command]
pub fn account_signout(app: AppHandle) -> Result<(), String> {
    let _ = std::fs::remove_file(account_path(&app));
    Ok(())
}

/// Connects the open database to the app's personal account in the background.
/// Best-effort: the database still opens normally when the cloud is
/// unreachable (the error is recorded in the sync status for later).
pub fn auto_connect_account(app: &AppHandle) {
    let Some(account) = account_load(app) else { return };
    let handle = app.clone();
    std::thread::spawn(move || {
        let email = account.email.clone();
        let password = account.password.clone();
        if let Err(e) = with_open_conn(&handle, |conn| {
            connect_db_to_account(conn, &email, &password)
        }) {
            let _ = with_open_conn(&handle, |conn| {
                meta_set(conn, "last_error", &e)?;
                Ok(())
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Arc, Mutex as StdMutex};

    struct MemTransport {
        store: Arc<StdMutex<Vec<SyncOp>>>,
        schema: Arc<StdMutex<String>>,
        peers: Arc<StdMutex<Vec<String>>>,
    }

    /// A transport that rejects multi-op batches the way the deployed relay
    /// did, to exercise the single-op fallback in push_ops_with_fallback.
    struct MultiOpRejectingTransport {
        inner: MemTransport,
        reject_multi: bool,
        fail_single_seq: i64,
    }

    impl Transport for MultiOpRejectingTransport {
        fn push(
            &self,
            db_id: &str,
            site_id: &str,
            schema_key: &str,
            ops: &[SyncOp],
        ) -> Result<(), String> {
            if self.reject_multi && ops.len() > 1 {
                return Err("Relay push returned status 500".into());
            }
            if ops.len() == 1 && ops[0].seq == self.fail_single_seq {
                return Err("Relay push returned status 500".into());
            }
            self.inner.push(db_id, site_id, schema_key, ops)
        }

        fn pull(
            &self,
            db_id: &str,
            after: &str,
            wait_ms: u32,
        ) -> Result<(Vec<SyncOp>, Vec<String>, String), String> {
            self.inner.pull(db_id, after, wait_ms)
        }
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

    fn test_op(site: &str, seq: i64, hlc: &str, table: &str) -> SyncOp {
        SyncOp {
            site: site.into(),
            seq,
            hlc: hlc.into(),
            table: table.into(),
            pk: json!({"id": seq}),
            row: json!({"id": seq}).into(),
            op: "upsert".into(),
            pk_json_raw: "".into(),
        }
    }

    #[test]
    fn test_push_fallback_pushes_batch_one_at_a_time() {
        let t = MultiOpRejectingTransport {
            inner: MemTransport {
                store: Arc::new(StdMutex::new(Vec::new())),
                schema: Arc::new(StdMutex::new(String::new())),
                peers: Arc::new(StdMutex::new(Vec::new())),
            },
            reject_multi: true,
            fail_single_seq: 0,
        };
        let ops = vec![
            test_op("a", 14, "20260811045336.382", "inventory_logs"),
            test_op("a", 15, "20260811045336.529", "inventory_logs"),
        ];
        let (pushed, last) = push_ops_with_fallback(&t, "db", "a", "k", &ops).unwrap();
        assert_eq!(pushed, 2);
        assert_eq!(last, 15);
        let store = t.inner.store.lock().unwrap();
        assert_eq!(store.len(), 2);
    }

    #[test]
    fn test_push_fallback_reports_error_when_all_single_ops_fail() {
        let t = MultiOpRejectingTransport {
            inner: MemTransport {
                store: Arc::new(StdMutex::new(Vec::new())),
                schema: Arc::new(StdMutex::new(String::new())),
                peers: Arc::new(StdMutex::new(Vec::new())),
            },
            reject_multi: true,
            fail_single_seq: 14,
        };
        let ops = vec![
            test_op("a", 14, "20260811045336.382", "inventory_logs"),
            test_op("a", 15, "20260811045336.529", "inventory_logs"),
        ];
        let err = push_ops_with_fallback(&t, "db", "a", "k", &ops).unwrap_err();
        assert!(err.contains("500"), "expected the batched error: {err}");
        let store = t.inner.store.lock().unwrap();
        assert!(store.is_empty(), "nothing may be recorded as pushed");
    }

    #[test]
    fn test_old_template_migrates_to_equal_key() {
        let fresh = setup_db();
        ensure_schema(&fresh).unwrap();
        let mut old = Connection::open_in_memory().unwrap();
        old.execute_batch(crate::INVENTORY_SCHEMA).unwrap();
        old.execute_batch(
            "DROP TABLE batches;
             CREATE TABLE batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL REFERENCES products(id),
                batch_number VARCHAR(100),
                supplier_name VARCHAR(255),
                unit_cost_price NUMERIC(12, 2) NOT NULL,
                purchase_date DATE NOT NULL,
                status VARCHAR(30) DEFAULT 'in_inventory'
                    CHECK (status IN ('ordered','shipping','arrived','in_inventory','used','reserved')),
                notes TEXT
             );",
        )
        .unwrap();
        let before = compute_schema_key(&old).unwrap();
        ensure_schema(&old).unwrap();
        let cols: Vec<String> = old
            .prepare("PRAGMA table_info(batches)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(cols.contains(&"is_removed".to_string()), "old batches should gain is_removed");
        let after = compute_schema_key(&old).unwrap();
        let fresh_key = compute_schema_key(&fresh).unwrap();
        assert_ne!(before, after);
        assert_eq!(after, fresh_key, "migrated DB must match fresh template key");
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
            let _ = dbreader_relay::serve(relay2, port);
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

        let transport = RelayTransport { endpoint: endpoint.clone(), token: "secret".into(), team_id: String::new(), file_id: String::new() };
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

        let bad = RelayTransport { endpoint: endpoint.clone(), token: "nope".into(), team_id: String::new(), file_id: String::new() };
        assert!(bad.push("dbtest", &site, &schema, &ops).is_err());
        assert!(bad.pull("dbtest", "", 0).is_err());

        drop(server);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_relay_long_poll_live() {
        let root = std::env::temp_dir().join(format!("dbreader-relay-live-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let relay = Arc::new(dbreader_relay::Relay::new(root.clone(), None).unwrap());
        let relay2 = relay.clone();
        let port: u16 = 18_992;
        let server = std::thread::spawn(move || {
            let _ = dbreader_relay::serve(relay2, port);
        });
        let endpoint = format!("http://127.0.0.1:{port}");

        let transport = RelayTransport { endpoint: endpoint.clone(), token: String::new(), team_id: String::new(), file_id: String::new() };
        let transport2 = RelayTransport { endpoint, token: String::new(), team_id: String::new(), file_id: String::new() };
        let conn = setup_db();
        ensure_schema(&conn).unwrap();
        ensure_triggers(&conn).unwrap();
        let site = site_id_or_create(&conn).unwrap();
        conn.execute(
            "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Chardonnay', 'CHR-001', 'bottle', 3)",
            [],
        )
        .unwrap();
        let ops = local_ops(&conn, &site, 0).unwrap();
        assert!(!ops.is_empty());

        let waiter = std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let result = transport2.pull("dbtest", "", 30_000).unwrap();
            (start.elapsed(), result)
        });
        std::thread::sleep(Duration::from_millis(300));
        transport.push("dbtest", &site, "", &ops).unwrap();
        let (elapsed, (pulled, _peers, _schema)) = waiter.join().unwrap();
        assert!(elapsed < Duration::from_secs(5), "live pull took {:?}", elapsed);
        assert_eq!(pulled.len(), ops.len());

        drop(server);
        let _ = std::fs::remove_dir_all(root);
    }

    /// Full client-side wiring test against the live cloud API. Gated behind
    /// DBREADER_LIVE_TEST=1 since it needs the deployed backend and network.
    /// Proves: device account bootstrap, team create, file publish (S3 PUT +
    /// confirm), then a real push + pull through RelayTransport.
    #[test]
    fn test_cloud_relay_live() {
        if std::env::var("DBREADER_LIVE_TEST").unwrap_or_default() != "1" {
            return;
        }
        let endpoint = std::env::var("DBREADER_CLOUD_ENDPOINT").unwrap_or_else(|_| {
            "https://y0nzvgypjb.execute-api.ap-southeast-2.amazonaws.com".to_string()
        });
        let site_id = format!("{:x}", uuid::Uuid::new_v4().simple());
        let email = format!("device-{}@dbreader.dev", site_id);
        let password = format!("{:x}", uuid::Uuid::new_v4().simple());

        let api = CloudApi::new(&endpoint).unwrap();
        let token = api.ensure_account(&email, &password).unwrap();
        assert!(!token.is_empty(), "bootstrap account failed");
        let team_id = api
            .create_team(&token, &format!("dbtest-{}", &site_id[..8]))
            .unwrap();
        let file_id = api.publish_file(&token, &team_id, "dbtest.db").unwrap();

        let conn = setup_db();
        ensure_schema(&conn).unwrap();
        ensure_triggers(&conn).unwrap();
        let site = site_id_or_create(&conn).unwrap();
        let schema = compute_schema_key(&conn).unwrap();
        conn.execute(
            "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Cloud Pinot', 'CLD-001', 'bottle', 2)",
            [],
        )
        .unwrap();
        let ops = local_ops(&conn, &site, 0).unwrap();
        assert!(!ops.is_empty());

        let transport = RelayTransport {
            endpoint: endpoint.clone(),
            token: token.clone(),
            team_id: team_id.clone(),
            file_id: file_id.clone(),
        };
        transport.push(&team_id, &site, &schema, &ops).unwrap();

        let (pulled, peers, schema_out) = transport.pull(&team_id, "", 0).unwrap();
        assert_eq!(schema_out, schema);
        assert!(peers.contains(&site));
        assert_eq!(
            pulled.len(),
            ops.len(),
            "pulled {} ops, expected {}",
            pulled.len(),
            ops.len()
        );
        let mut expected: Vec<&SyncOp> = ops.iter().collect();
        let mut actual: Vec<&SyncOp> = pulled.iter().collect();
        expected.sort_by_key(|o| (o.hlc.clone(), o.site.clone(), o.seq));
        actual.sort_by_key(|o| (o.hlc.clone(), o.site.clone(), o.seq));
        for (e, a) in expected.iter().zip(actual.iter()) {
            assert_eq!(e.table, a.table);
            assert_eq!(e.op, a.op);
            assert_eq!(e.pk, a.pk);
            assert_eq!(e.row, a.row);
            assert_eq!(e.hlc, a.hlc);
            assert_eq!(e.seq, a.seq);
        }

        let bad = RelayTransport {
            endpoint: endpoint.clone(),
            token: "nope".into(),
            team_id: team_id.clone(),
            file_id: file_id.clone(),
        };
        assert!(bad.push(&team_id, &site, &schema, &ops).is_err());
    }

    /// Two-device flow against the live cloud API (DBREADER_LIVE_TEST=1):
    /// device A creates the team + publishes the file, device B registers,
    /// joins with the invite code, finds the file, then both exchange ops.
    #[test]
    fn test_cloud_join_live() {
        if std::env::var("DBREADER_LIVE_TEST").unwrap_or_default() != "1" {
            return;
        }
        let endpoint = std::env::var("DBREADER_CLOUD_ENDPOINT").unwrap_or_else(|_| {
            "https://y0nzvgypjb.execute-api.ap-southeast-2.amazonaws.com".to_string()
        });
        let api = CloudApi::new(&endpoint).unwrap();

        let site_a = format!("{:x}", uuid::Uuid::new_v4().simple());
        let token_a = api
            .ensure_account(&format!("device-{}@dbreader.dev", site_a), &format!("{:x}", uuid::Uuid::new_v4().simple()))
            .unwrap();
        let team_id = api
            .create_team(&token_a, &format!("dbtest-{}", &site_a[..8]))
            .unwrap();
        let file_id = api.publish_file(&token_a, &team_id, "dbtest.db").unwrap();
        let code = api.invite_code(&token_a, &team_id).unwrap();
        assert_eq!(code.len(), 8, "invite code should be 8 characters");

        let site_b = format!("{:x}", uuid::Uuid::new_v4().simple());
        let token_b = api
            .ensure_account(&format!("device-{}@dbreader.dev", site_b), &format!("{:x}", uuid::Uuid::new_v4().simple()))
            .unwrap();
        let joined = api.join_team(&token_b, &code).unwrap();
        assert_eq!(joined, team_id, "device B should land in the same team");
        let found_id = api.latest_file(&token_b, &team_id).unwrap();
        assert_eq!(found_id, file_id);

        let ta = RelayTransport { endpoint: endpoint.clone(), token: token_a.clone(), team_id: team_id.clone(), file_id: file_id.clone() };
        let tb = RelayTransport { endpoint: endpoint.clone(), token: token_b.clone(), team_id: team_id.clone(), file_id: file_id.clone() };

        let conn_a = setup_db();
        ensure_schema(&conn_a).unwrap();
        ensure_triggers(&conn_a).unwrap();
        let site_a_db = site_id_or_create(&conn_a).unwrap();
        let schema = compute_schema_key(&conn_a).unwrap();
        conn_a
            .execute(
                "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Device A Wine', 'A-001', 'bottle', 2)",
                [],
            )
            .unwrap();
        let ops_a = local_ops(&conn_a, &site_a_db, 0).unwrap();
        assert!(!ops_a.is_empty());
        ta.push(&team_id, &site_a_db, &schema, &ops_a).unwrap();

        let conn_b = setup_db();
        ensure_schema(&conn_b).unwrap();
        ensure_triggers(&conn_b).unwrap();
        let site_b_db = site_id_or_create(&conn_b).unwrap();
        let (pulled, peers, schema_out) = tb.pull(&team_id, "", 0).unwrap();
        assert_eq!(schema_out, schema);
        assert!(peers.contains(&site_a_db));
        assert_eq!(pulled.len(), ops_a.len(), "device B should receive device A's ops");
        let applied = apply_batch(&conn_b, &pulled, "").unwrap();
        assert_eq!(applied, ops_a.len() as i64);
        let count: i64 = conn_b
            .query_row("SELECT COUNT(*) FROM products WHERE name = 'Device A Wine'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "device B should have applied device A's insert");

        conn_b
            .execute(
                "UPDATE products SET name = 'Renamed on B' WHERE name = 'Device A Wine'",
                [],
            )
            .unwrap();
        let ops_b = local_ops(&conn_b, &site_b_db, 0).unwrap();
        assert!(!ops_b.is_empty());
        tb.push(&team_id, &site_b_db, &schema, &ops_b).unwrap();
        let (pulled_back, _peers, _schema) = ta.pull(&team_id, "", 0).unwrap();
        assert!(
            pulled_back.iter().any(|o| o.table == "products"),
            "device A should receive device B's ops back"
        );
    }

    /// Personal-account flow against the live cloud API (DBREADER_LIVE_TEST=1):
    /// the same account signs in on two devices; the second device reconnects
    /// to the database via the account (no invite code), then syncs both ways.
    #[test]
    fn test_cloud_personal_account_live() {
        if std::env::var("DBREADER_LIVE_TEST").unwrap_or_default() != "1" {
            return;
        }
        let endpoint = std::env::var("DBREADER_CLOUD_ENDPOINT").unwrap_or_else(|_| {
            "https://y0nzvgypjb.execute-api.ap-southeast-2.amazonaws.com".to_string()
        });
        let api = CloudApi::new(&endpoint).unwrap();
        let email = format!("personal-{}@dbreader.dev", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let password = format!("{:x}", uuid::Uuid::new_v4().simple());
        let db_id = format!("db-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);

        let token_a = api.ensure_account(&email, &password).unwrap();
        let team_id = api.create_team(&token_a, &db_id).unwrap();
        let file_id = api.publish_file(&token_a, &team_id, &format!("{}.db", db_id)).unwrap();

        let token_b = api.ensure_account(&email, &password).unwrap();
        assert!(!token_b.is_empty(), "second device should get a valid session");
        let found = api.find_file_for_db(&token_b, &db_id).unwrap();
        let (found_team, found_file) = found.expect("second device should find the database via the account");
        assert_eq!(found_team, team_id);
        assert_eq!(found_file, file_id);

        let ta = RelayTransport { endpoint: endpoint.clone(), token: token_a.clone(), team_id: team_id.clone(), file_id: file_id.clone() };
        let tb = RelayTransport { endpoint: endpoint.clone(), token: token_b, team_id: found_team, file_id: found_file };

        let conn_a = setup_db();
        ensure_schema(&conn_a).unwrap();
        ensure_triggers(&conn_a).unwrap();
        let site_a = site_id_or_create(&conn_a).unwrap();
        let schema = compute_schema_key(&conn_a).unwrap();
        conn_a
            .execute(
                "INSERT INTO products (category_id, name, sku, base_unit_name, reorder_threshold) VALUES (1, 'Account Wine', 'ACC-1', 'bottle', 5)",
                [],
            )
            .unwrap();
        let ops_a = local_ops(&conn_a, &site_a, 0).unwrap();
        assert!(!ops_a.is_empty());
        ta.push(&team_id, &site_a, &schema, &ops_a).unwrap();

        let conn_b = setup_db();
        ensure_schema(&conn_b).unwrap();
        ensure_triggers(&conn_b).unwrap();
        let (pulled, _peers, schema_out) = tb.pull(&team_id, "", 0).unwrap();
        assert_eq!(schema_out, schema);
        assert_eq!(pulled.len(), ops_a.len(), "second device should get the ops");
        let applied = apply_batch(&conn_b, &pulled, "").unwrap();
        assert_eq!(applied, ops_a.len() as i64);
        let count: i64 = conn_b
            .query_row("SELECT COUNT(*) FROM products WHERE name = 'Account Wine'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "second device should have the account device's insert");
    }
}