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
    use std::io::{BufRead, BufReader, Read};
    let (host, port, path) = parse_netloc(url);
    let mut conn = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
    conn.set_read_timeout(Some(std::time::Duration::from_secs(60)))
        .map_err(|e| e.to_string())?;
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    conn.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

    // Parse status line + headers properly. The Lambda runtime API serves
    // /next responses with Transfer-Encoding: chunked for larger events; the
    // naive read-to-EOF approach captured the chunk framing inside the body
    // (breaking multi-op pushes).
    let mut reader = BufReader::new(conn);
    let mut status_line = String::new();
    reader
        .read_line(&mut status_line)
        .map_err(|e| format!("read status line: {e}"))?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);
    let mut resp_headers = String::new();
    let mut content_length: Option<usize> = None;
    let mut chunked = false;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| format!("read header: {e}"))? == 0 {
            break;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        resp_headers.push_str(trimmed);
        resp_headers.push('\n');
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse::<usize>().ok();
        } else if lower.trim_start().starts_with("transfer-encoding:")
            && lower.to_ascii_lowercase().contains("chunked")
        {
            chunked = true;
        }
    }

    let body = if let Some(cl) = content_length {
        let mut buf = vec![0u8; cl];
        reader
            .read_exact(&mut buf)
            .map_err(|e| format!("read body: {e}"))?;
        String::from_utf8_lossy(&buf).into_owned()
    } else if chunked {
        read_chunked(&mut reader)?
    } else {
        let mut s = String::new();
        reader.read_to_string(&mut s).map_err(|e| e.to_string())?;
        s
    };
    Ok((status, body, resp_headers))
}

/// Decodes an HTTP/1.1 chunked-transfer body from the reader.
fn read_chunked(reader: &mut impl std::io::BufRead) -> Result<String, String> {
    use std::io::Read;
    let mut out = Vec::new();
    loop {
        let mut size_line = String::new();
        let n = reader
            .read_line(&mut size_line)
            .map_err(|e| format!("read chunk size: {e}"))?;
        if n == 0 {
            break;
        }
        let size_str = size_line.trim().split(';').next().unwrap_or("");
        let size = usize::from_str_radix(size_str.trim(), 16)
            .map_err(|e| format!("bad chunk size {:?}: {e}", size_line.trim()))?;
        if size == 0 {
            // Trailer headers until the final blank line.
            loop {
                let mut t = String::new();
                if reader.read_line(&mut t).map_err(|e| format!("read trailer: {e}"))? == 0 {
                    break;
                }
                if t == "\r\n" || t == "\n" {
                    break;
                }
            }
            break;
        }
        let mut buf = vec![0u8; size];
        reader
            .read_exact(&mut buf)
            .map_err(|e| format!("read chunk data: {e}"))?;
        out.extend_from_slice(&buf);
        let mut crlf = [0u8; 2];
        reader.read_exact(&mut crlf).map_err(|e| format!("chunk crlf: {e}"))?;
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
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
                // Query params arrive as strings, but callers expect numbers for
                // `seq` and `wait` (pull cursor position and long-poll duration).
                let val = if k == "seq" || k == "wait" {
                    v.parse::<i64>()
                        .map(|n| json!(n))
                        .unwrap_or_else(|_| json!(v))
                } else {
                    json!(v)
                };
                m.insert(k, val);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn merge_query(body: &mut Value, qs: &str) {
        if let Value::Object(ref mut m) = body {
            for (k, v) in parse_query(qs) {
                if !m.contains_key(&k) {
                    let val = if k == "seq" || k == "wait" {
                        v.parse::<i64>()
                            .map(|n| json!(n))
                            .unwrap_or_else(|_| json!(v))
                    } else {
                        json!(v)
                    };
                    m.insert(k, val);
                }
            }
        }
    }

    #[test]
    fn query_params_coerce_seq_and_wait_to_numbers() {
        let mut body = json!({});
        merge_query(&mut body, "team_id=t1&file_id=f1&site=s1&h=20260811045336.382&seq=7&wait=12000");
        assert_eq!(body["seq"], 7i64);
        assert_eq!(body["wait"], 12000i64);
        assert_eq!(body["team_id"], "t1");
        assert_eq!(body["site"], "s1");
        assert_eq!(body["h"], "20260811045336.382");
    }

    #[test]
    fn query_params_do_not_override_body() {
        let mut body = json!({"seq": 3});
        merge_query(&mut body, "seq=9&wait=5");
        assert_eq!(body["seq"], 3i64, "body value wins over query param");
        assert_eq!(body["wait"], 5i64);
    }
}