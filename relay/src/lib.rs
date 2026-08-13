use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

const PULL_LIMIT: usize = 2000;

#[derive(Default)]
struct Notify {
    gen: Mutex<u64>,
    cond: Condvar,
}

#[derive(Serialize, Deserialize, Debug)]
struct PushBody {
    #[serde(default)]
    db: String,
    #[serde(default)]
    file_id: String,
    #[serde(default)]
    site: String,
    #[serde(default)]
    schema: String,
    #[serde(default)]
    ops: Vec<Value>,
}

pub struct Relay {
    root: PathBuf,
    token: Option<String>,
    lock: Mutex<()>,
    notify: Mutex<std::collections::HashMap<String, std::sync::Arc<Notify>>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct PullBody {
    ops: Vec<Value>,
    sites: Vec<String>,
    schema: String,
}

#[derive(Debug)]
pub struct HttpReply {
    pub status: u16,
    pub body: String,
}

impl Relay {
    pub fn new(root: PathBuf, token: Option<String>) -> Result<Self, String> {
        fs::create_dir_all(root.join("db"))
            .map_err(|e| format!("Cannot create relay root: {}", e))?;
        Ok(Relay {
            root,
            token,
            lock: Mutex::new(()),
            notify: Mutex::new(std::collections::HashMap::new()),
        })
    }

    fn notify_for(&self, db: &str) -> std::sync::Arc<Notify> {
        let mut map = self.notify.lock().map_err(|_| ()).ok().expect("notify lock poisoned");
        map.entry(db.to_string()).or_default().clone()
    }

    fn notify_db(&self, db: &str) {
        let not = self.notify_for(db);
        {
            let mut g = not.gen.lock().map_err(|_| ()).ok().expect("gen lock poisoned");
            *g += 1;
        }
        not.cond.notify_all();
    }

    fn db_dir(&self, db: &str) -> PathBuf {
        self.root.join("db").join(sanitize_name(db))
    }

    fn site_ops_file(&self, db: &str, site: &str) -> PathBuf {
        self.db_dir(db).join("site").join(sanitize_name(site)).join("ops.jsonl")
    }

    fn authorized(&self, auth: &str) -> bool {
        match &self.token {
            None => true,
            Some(t) => auth == format!("Bearer {}", t),
        }
    }

    pub fn handle(
        &self,
        method: &str,
        path: &str,
        auth: &str,
        body: &str,
    ) -> Result<HttpReply, HttpReply> {
        if !self.authorized(auth) {
            return Err(HttpReply { status: 401, body: "{\"error\":\"unauthorized\"}".into() });
        }
        let raw_path = path;
        let path = path.split('?').next().unwrap_or(path);
        match (method, path) {
            ("GET", "/health") => Ok(HttpReply { status: 200, body: "{\"ok\":true}".into() }),
            ("POST", "/api/v1/push") => self
                .handle_push(body)
                .map(|_| HttpReply { status: 200, body: "{\"ok\":true}".into() }),
            ("GET", "/api/v1/pull") => self.handle_pull(raw_path),
            _ => Err(HttpReply { status: 404, body: "{\"error\":\"not found\"}".into() }),
        }
    }

    fn handle_push(&self, body: &str) -> Result<(), HttpReply> {
        let push: PushBody = serde_json::from_str(body)
            .map_err(|e| HttpReply { status: 400, body: format!("{{\"error\":\"{e}\"}}") })?;
        // The deployed relay identifies files by file_id; the in-process
        // copy keeps that by partitioning on file_id when present.
        let db = if push.file_id.is_empty() { push.db } else { push.file_id };
        if db.trim().is_empty() {
            return Err(HttpReply { status: 400, body: "{\"error\":\"db is required\"}".into() });
        }
        if push.ops.is_empty() {
            return Ok(());
        }
        let _guard = self.lock.lock().map_err(|_| HttpReply {
            status: 500,
            body: "{\"error\":\"lock poisoned\"}".into(),
        })?;
        let dir = self.db_dir(&db);
        fs::create_dir_all(dir.join("site"))
            .map_err(|e| HttpReply { status: 500, body: format!("{{\"error\":\"{e}\"}}") })?;
        let mut sites = self.read_sites(&db);
        if !push.site.is_empty() && !sites.contains(&push.site) {
            sites.push(push.site.clone());
            self.write_json(&dir.join("sites.json"), &sites)
                .map_err(|e| HttpReply { status: 500, body: format!("{{\"error\":\"{e}\"}}") })?;
        }
        if !push.schema.is_empty() {
            let _ = atomic_write(&dir.join("schema.json"), &push.schema);
        }
        let file = self.site_ops_file(&db, &push.site);
        let max_seen = self
            .max_seq(&file)
            .map_err(|e| HttpReply { status: 500, body: format!("{{\"error\":\"{e}\"}}") })?;
        let mut out = String::new();
        for op in &push.ops {
            let seq = op.get("seq").and_then(|v| v.as_i64()).unwrap_or(0);
            if seq > max_seen {
                out.push_str(&op.to_string());
                out.push('\n');
            }
        }
        if out.is_empty() {
            return Ok(());
        }
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| HttpReply { status: 500, body: format!("{{\"error\":\"{e}\"}}") })?;
        }
        atomic_append(&file, &out).map_err(|e| HttpReply {
            status: 500,
            body: format!("{{\"error\":\"{e}\"}}"),
        })?;
        drop(_guard);
        self.notify_db(&db);
        Ok(())
    }

    fn collect_sorted(&self, db: &str, h: &str, site: &str, seq: i64) -> Result<Vec<Value>, HttpReply> {
        let _guard = self.lock.lock().map_err(|_| HttpReply {
            status: 500,
            body: "{\"error\":\"lock poisoned\"}".into(),
        })?;
        let mut ops = self.collect_ops(db, h, site, seq)?;
        ops.sort_by(|a, b| {
            (
                a.get("hlc").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                a.get("site").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                a.get("seq").and_then(|v| v.as_i64()).unwrap_or(0),
            )
                .cmp(&(
                    b.get("hlc").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    b.get("site").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    b.get("seq").and_then(|v| v.as_i64()).unwrap_or(0),
                ))
        });
        ops.truncate(PULL_LIMIT);
        Ok(ops)
    }

    fn handle_pull(&self, url: &str) -> Result<HttpReply, HttpReply> {
        let params = parse_query(url);
        let db_param = params.get("db").cloned().unwrap_or_default();
        let file_id = params.get("file_id").cloned().unwrap_or_default();
        // Mirror the deployed relay: file_id partitions the ops when present.
        let db = if file_id.is_empty() { db_param } else { file_id };
        let h = params.get("h").cloned().unwrap_or_default();
        let site = params.get("site").cloned().unwrap_or_default();
        let seq = params.get("seq").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
        let wait = params.get("wait").and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        if db.is_empty() {
            return Err(HttpReply { status: 400, body: "{\"error\":\"db is required\"}".into() });
        }
        let mut ops = self.collect_sorted(&db, &h, &site, seq)?;
        if ops.is_empty() && wait > 0 {
            let not = self.notify_for(&db);
            let deadline = Instant::now() + Duration::from_millis(wait);
            loop {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                {
                    let gen = not.gen.lock().map_err(|_| HttpReply {
                        status: 500,
                        body: "{\"error\":\"lock poisoned\"}".into(),
                    })?;
                    let (guard, _res) = not
                        .cond
                        .wait_timeout(gen, deadline - now)
                        .map_err(|_| HttpReply {
                            status: 500,
                            body: "{\"error\":\"lock poisoned\"}".into(),
                        })?;
                    drop(guard);
                }
                ops = self.collect_sorted(&db, &h, &site, seq)?;
                if !ops.is_empty() || Instant::now() >= deadline {
                    break;
                }
            }
        }
        let reply = PullBody {
            ops,
            sites: self.read_sites(&db),
            schema: fs::read_to_string(&self.db_dir(&db).join("schema.json")).unwrap_or_default(),
        };
        serde_json::to_string(&reply)
            .map(|body| HttpReply { status: 200, body })
            .map_err(|e| HttpReply { status: 500, body: format!("{{\"error\":\"{e}\"}}") })
    }

    fn collect_ops(&self, db: &str, h: &str, site: &str, seq: i64) -> Result<Vec<Value>, HttpReply> {
        let site_root = self.db_dir(db).join("site");
        let mut ops = Vec::new();
        let entries = match fs::read_dir(&site_root) {
            Ok(e) => e,
            Err(_) => return Ok(ops),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let file = if is_dir {
                path.join("ops.jsonl")
            } else {
                path
            };
            if !file.is_file() {
                continue;
            }
            let content = fs::read_to_string(&file).map_err(|e| HttpReply {
                status: 500,
                body: format!("{{\"error\":\"{e}\"}}"),
            })?;
            for line in content.lines() {
                let op: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let oh = op.get("hlc").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let os = op.get("site").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let oseq = op.get("seq").and_then(|v| v.as_i64()).unwrap_or(0);
                let oh = oh.as_str();
                let os = os.as_str();
                if oh > h || (oh == h && (os > site || (os == site && oseq > seq))) {
                    ops.push(op);
                }
            }
        }
        Ok(ops)
    }

    fn max_seq(&self, file: &PathBuf) -> Result<i64, String> {
        let content = fs::read_to_string(file).unwrap_or_default();
        let mut max = 0i64;
        for line in content.lines() {
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                if let Some(s) = v.get("seq").and_then(|x| x.as_i64()) {
                    if s > max {
                        max = s;
                    }
                }
            }
        }
        Ok(max)
    }

    fn read_sites(&self, db: &str) -> Vec<String> {
        self.read_json(&self.db_dir(db).join("sites.json"))
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn read_json(&self, file: &PathBuf) -> Option<String> {
        fs::read_to_string(file).ok()
    }

    fn write_json(&self, file: &PathBuf, value: &impl Serialize) -> Result<(), String> {
        let data = serde_json::to_string(value).map_err(|e| e.to_string())?;
        atomic_write(file, &data)
    }
}

fn atomic_write(file: &PathBuf, data: &str) -> Result<(), String> {
    let tmp = file.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, file).map_err(|e| e.to_string())
}

fn atomic_append(file: &PathBuf, data: &str) -> Result<(), String> {
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(file)
        .map_err(|e| e.to_string())?;
    f.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    f.flush().map_err(|e| e.to_string())
}

fn sanitize_name(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' || c == '.' { c } else { '_' })
        .collect()
}

fn parse_query(url: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    if let Some(q) = url.split('?').nth(1) {
        for pair in q.split('&') {
            let mut it = pair.splitn(2, '=');
            if let (Some(k), Some(v)) = (it.next(), it.next()) {
                map.insert(k.to_string(), percent_decode(v));
            }
        }
    }
    map
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn serve(relay: std::sync::Arc<Relay>, port: u16) -> Result<(), String> {
    let server = tiny_http::Server::http(("0.0.0.0", port))
        .map_err(|e| format!("Cannot bind port {}: {}", port, e))?;
    eprintln!("dbreader-relay listening on port {}", port);
    for request in server.incoming_requests() {
        let relay = relay.clone();
        std::thread::spawn(move || {
            let mut request = request;
            let method = request.method().to_string();
            let url = request.url().to_string();
            let auth = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str().to_string())
                .unwrap_or_default();
            let mut body = String::new();
            if method == "POST" {
                let _ = request.as_reader().read_to_string(&mut body);
            }
            let reply = match relay.handle(&method, &url, &auth, &body) {
                Ok(r) => r,
                Err(r) => r,
            };
            let _ = request.respond(
                tiny_http::Response::from_string(reply.body)
                    .with_status_code(reply.status),
            );
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn op(site: &str, seq: i64, hlc: &str, table: &str) -> Value {
        serde_json::json!({
            "site": site, "seq": seq, "hlc": hlc, "table": table,
            "pk": {"id": 1}, "row": {"name": format!("{}-{}", site, seq)}, "op": "upsert"
        })
    }

    #[test]
    fn push_pull_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let relay = Relay::new(dir.path().join("sync"), None).unwrap();
        let db = "wineshop";
        let a = op("siteA", 1, "20260808120000.001", "products");
        let b = op("siteB", 1, "20260808120000.002", "products");
        let push = format!(
            "{{\"db\":\"{}\",\"site\":\"siteA\",\"schema\":\"k1\",\"ops\":[{}]}}",
            db, a
        );
        relay.handle("POST", "/api/v1/push", "", &push).unwrap();
        let push2 = format!(
            "{{\"db\":\"{}\",\"site\":\"siteB\",\"schema\":\"k1\",\"ops\":[{}]}}",
            db, b
        );
        relay.handle("POST", "/api/v1/push", "", &push2).unwrap();

        let reply = relay.handle("GET", "/api/v1/pull?db=wineshop&h=&site=&seq=0", "", "").unwrap();
        let body: PullBody = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(body.ops.len(), 2);
        assert_eq!(body.sites, vec!["siteA", "siteB"]);
        assert_eq!(body.schema, "k1");

        let reply = relay
            .handle("GET", "/api/v1/pull?db=wineshop&h=20260808120000.001&site=siteA&seq=1", "", "")
            .unwrap();
        let body: PullBody = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(body.ops.len(), 1);
        assert_eq!(body.ops[0]["site"], "siteB");
    }

    #[test]
    fn dedupes_repushed_ops() {
        let dir = tempfile::tempdir().unwrap();
        let relay = Relay::new(dir.path().join("sync"), None).unwrap();
        let a = op("siteA", 1, "20260808120000.001", "products");
        let push = format!(
            "{{\"db\":\"d\",\"site\":\"siteA\",\"schema\":\"k\",\"ops\":[{}]}}",
            a
        );
        relay.handle("POST", "/api/v1/push", "", &push).unwrap();
        relay.handle("POST", "/api/v1/push", "", &push).unwrap();
        let reply = relay.handle("GET", "/api/v1/pull?db=d&h=&site=&seq=0", "", "").unwrap();
        let body: PullBody = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(body.ops.len(), 1);
    }

    #[test]
    fn rejects_bad_token() {
        let dir = tempfile::tempdir().unwrap();
        let relay = Relay::new(dir.path().join("sync"), Some("secret".into())).unwrap();
        let reply = relay.handle("GET", "/api/v1/pull?db=d", "", "").unwrap_err();
        assert_eq!(reply.status, 401);
        let reply = relay.handle("GET", "/api/v1/pull?db=d", "Bearer secret", "").unwrap();
        assert_eq!(reply.status, 200);
    }

    #[test]
    fn long_poll_wakes_on_push() {
        let dir = tempfile::tempdir().unwrap();
        let relay = std::sync::Arc::new(Relay::new(dir.path().join("sync"), None).unwrap());
        let r2 = relay.clone();
        let waiter = thread::spawn(move || {
            let start = std::time::Instant::now();
            let reply = r2
                .handle("GET", "/api/v1/pull?db=wineshop&h=&site=&seq=0&wait=5000", "", "")
                .unwrap();
            (start.elapsed(), reply)
        });
        thread::sleep(Duration::from_millis(200));
        let a = op("siteA", 1, "20260808120000.001", "products");
        let push = format!("{{\"db\":\"wineshop\",\"site\":\"siteA\",\"schema\":\"k1\",\"ops\":[{a}]}}");
        relay.handle("POST", "/api/v1/push", "", &push).unwrap();
        let (elapsed, reply) = waiter.join().unwrap();
        assert!(elapsed < Duration::from_secs(2), "wake took {:?}", elapsed);
        let body: PullBody = serde_json::from_str(&reply.body).unwrap();
        assert_eq!(body.ops.len(), 1);
    }

    #[test]
    fn long_poll_times_out_empty() {
        let dir = tempfile::tempdir().unwrap();
        let relay = Relay::new(dir.path().join("sync"), None).unwrap();
        let start = std::time::Instant::now();
        let reply = relay
            .handle("GET", "/api/v1/pull?db=wineshop&h=&site=&seq=0&wait=300", "", "")
            .unwrap();
        let elapsed = start.elapsed();
        assert!(elapsed >= Duration::from_millis(250), "returned after {:?}", elapsed);
        let body: PullBody = serde_json::from_str(&reply.body).unwrap();
        assert!(body.ops.is_empty());
    }

    #[test]
    fn full_http_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let relay = Relay::new(dir.path().join("sync"), Some("secret".into())).unwrap();
        let handle = relay.lock.lock().unwrap();
        drop(handle);
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        thread::spawn(move || {
            for mut request in server.incoming_requests() {
                let method = request.method().to_string();
                let url = request.url().to_string();
                let auth = request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Authorization"))
                    .map(|h| h.value.as_str().to_string())
                    .unwrap_or_default();
                let mut body = String::new();
                if method == "POST" {
                    let _ = request.as_reader().read_to_string(&mut body);
                }
                let reply = match relay.handle(&method, &url, &auth, &body) {
                    Ok(r) => r,
                    Err(r) => r,
                };
                let _ = request.respond(
                    tiny_http::Response::from_string(reply.body)
                        .with_status_code(reply.status),
                );
            }
        });

        let agent = ureq::config::Config::builder().build().new_agent();
        let a = op("siteA", 1, "20260808120000.001", "products");
        let push = format!(
            "{{\"db\":\"d\",\"site\":\"siteA\",\"schema\":\"k\",\"ops\":[{}]}}",
            a
        );
        let resp = agent
            .post(&format!("http://127.0.0.1:{}/api/v1/push", port))
            .header("Authorization", "Bearer secret")
            .send(&push)
            .unwrap();
        assert_eq!(resp.status(), 200);
        let mut resp = agent
            .get(&format!("http://127.0.0.1:{}/api/v1/pull?db=d&h=&site=&seq=0", port))
            .header("Authorization", "Bearer secret")
            .call()
            .unwrap();
        let text = resp.body_mut().read_to_string().unwrap();
        let body: PullBody = serde_json::from_str(&text).unwrap();
        assert_eq!(body.ops.len(), 1);
        let _ = Duration::from_millis(1);
    }
}
