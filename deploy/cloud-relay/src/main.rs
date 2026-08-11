mod api;
mod ddb;
mod s3;
mod sigv4;
mod store_ddb;

use api::Store;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;

const RUNTIME_BASE: &str = "2018-06-01/runtime/invocation";

fn main() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[cloud-relay] panic: {}", info);
    }));

    let runtime_api = match std::env::var("AWS_LAMBDA_RUNTIME_API") {
        Ok(v) => v,
        Err(_) => {
            eprintln!("[cloud-relay] AWS_LAMBDA_RUNTIME_API not set; not running inside Lambda. exiting.");
            std::process::exit(1);
        }
    };
    let endpoint = format!("http://{}/{}", runtime_api, RUNTIME_BASE);
    let store: Box<dyn Store> = Box::new(store_ddb::DdbStore::new());

    loop {
        match fetch_next(&endpoint) {
            Err(e) => {
                eprintln!("[cloud-relay] fetch error: {}; retrying in 500ms", e);
                std::thread::sleep(std::time::Duration::from_millis(500));
                continue;
            }
            Ok(None) => {
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
            Ok(Some((id, raw))) => {
                let (code, body, content_type) = handle_event(store.as_ref(), &raw);
                let payload = json!({
                    "statusCode": code,
                    "headers": {
                        "content-type": content_type,
                        "access-control-allow-origin": "*",
                        "access-control-allow-methods": "GET, POST, OPTIONS",
                        "access-control-allow-headers": "content-type, authorization"
                    },
                    "body": body,
                    "isBase64Encoded": false,
                });
                if let Err(e) = http_request("POST", &format!("{}/{}/response", endpoint, id), &payload.to_string()) {
                    eprintln!("[cloud-relay] report error: {}", e);
                }
            }
        }
    }
}

fn parse_netloc(url: &str) -> (String, u16, String) {
    let rest = url.strip_prefix("http://").unwrap_or(url);
    let (host_port, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };
    let (host, port) = match host_port.rfind(':') {
        Some(i) => (
            host_port[..i].to_string(),
            host_port[i + 1..].parse::<u16>().unwrap_or(80),
        ),
        None => (host_port.to_string(), 80),
    };
    (host, port, path)
}

fn http_request(method: &str, url: &str, body: &str) -> Result<(u16, String, String), String> {
    let (host, port, path) = parse_netloc(url);
    let mut conn = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    conn.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = String::new();
    conn.read_to_string(&mut raw).map_err(|e| e.to_string())?;
    let (head, rest) = match raw.split_once("\r\n\r\n") {
        Some((h, b)) => (h, b),
        None => (raw.as_str(), ""),
    };
    let status = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    let mut resp_headers = String::new();
    for line in head.lines().skip(1) {
        resp_headers.push_str(line);
        resp_headers.push('\n');
    }
    Ok((status, rest.to_string(), resp_headers))
}

fn fetch_next(endpoint: &str) -> Result<Option<(String, String)>, String> {
    let (status, body, headers) = http_request("GET", &format!("{}/next", endpoint), "")?;
    if status != 200 {
        return Err(format!("runtime next returned {}", status));
    }
    if body.is_empty() {
        return Ok(None);
    }
    let id = headers
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("lambda-runtime-aws-request-id:"))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".into());
    Ok(Some((id, body)))
}

fn handle_event(store: &dyn Store, raw: &str) -> (u16, String, String) {
    match handle_event_inner(store, raw) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[cloud-relay] handler error: {}", e);
            (500, json!({"error": "internal error"}).to_string(), "application/json".into())
        }
    }
}

fn handle_event_inner(store: &dyn Store, raw: &str) -> Result<(u16, String, String), String> {
    let evt: Value = serde_json::from_str(raw).map_err(|e| format!("bad event json: {}", e))?;

    if evt.get("type").and_then(|v| v.as_str()) == Some("Shutdown") {
        return Ok((200, "{}".into(), "application/json".into()));
    }

    let raw_path = evt.get("rawPath").and_then(|v| v.as_str()).unwrap_or("/");
    let path = strip_stage(raw_path);

    let method = evt
        .get("requestContext")
        .and_then(|c| c.get("http"))
        .and_then(|h| h.get("method"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();

    let headers = evt.get("headers").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let auth_val = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("authorization"))
        .and_then(|(_, v)| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let is_b64 = evt.get("isBase64Encoded").and_then(|v| v.as_bool()).unwrap_or(false);
    let body_raw = evt.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let body_bytes = if is_b64 { base64_decode(&body_raw) } else { body_raw.into_bytes() };
    let mut body: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    if let Value::Object(ref mut m) = body {
        for (k, v) in parse_query(&evt.get("rawQueryString").and_then(|v| v.as_str()).unwrap_or("")) {
            if !m.contains_key(&k) {
                m.insert(k, json!(v));
            }
        }
    }

    match method.as_str() {
        "OPTIONS" => Ok((200, "{}".into(), "application/json".into())),
        "GET" | "POST" => {
            let resp = api::route(store, &method, &path, &auth_val, &body);
            Ok((resp.status, resp.body.to_string(), "application/json".into()))
        }
        _ => Ok((
            200,
            json!({"error": "method not allowed"}).to_string(),
            "application/json".into(),
        )),
    }
}

fn strip_stage(path: &str) -> String {
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if let Some(i) = segs.iter().position(|s| *s == "api") {
        format!("/{}", segs[i..].join("/"))
    } else {
        path.to_string()
    }
}

fn parse_query(q: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for pair in q.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = match pair.find('=') {
            Some(i) => (&pair[..i], &pair[i + 1..]),
            None => (pair, ""),
        };
        out.push((url_decode(k), url_decode(v)));
    }
    out
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn base64_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => continue,
        } as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    out
}

#[allow(dead_code)]
fn status_line(detail: &str) -> String {
    detail.to_string()
}