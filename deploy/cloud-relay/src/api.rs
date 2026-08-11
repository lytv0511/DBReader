use argon2::Argon2;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

pub const ROLE_OWNER: &str = "owner";
pub const ROLE_FULL: &str = "full";
pub const ROLE_VIEWER: &str = "viewer";

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LIFE_SECS: i64 = 30 * 86400;
const PULL_LIMIT: usize = 2000;
const OPS_MAX_CHARS: usize = 380_000;
const SESSION_SECS: i64 = 30 * 86400;

// ---------- data model ----------

#[derive(Clone, Debug)]
pub struct User {
    pub email: String,
    pub nm: String,
    pub pw: String,
    pub created_ts: i64,
}

#[derive(Clone, Debug)]
pub struct SessionRec {
    pub token: String,
    pub email: String,
    pub expiry_ts: i64,
}

#[derive(Clone, Debug)]
pub struct TeamFile {
    pub team_id: String,
    pub file_id: String,
    pub nm: String,
    pub s3_key: String,
    pub size: i64,
    pub created_ts: i64,
    pub pub_by: String,
    pub done: bool,
    pub sites: Vec<String>,
    pub schema: String,
}

#[derive(Clone, Debug)]
pub struct Team {
    pub team_id: String,
    pub nm: String,
    pub owner: String,
    pub members: HashMap<String, String>,
    pub code: String,
    pub code_sha: String,
    pub code_ts: i64,
    pub created_ts: i64,
}

pub trait Store: Send + Sync {
    fn user_get(&self, email: &str) -> Option<User>;
    fn user_put(&self, u: &User);
    fn session_get(&self, token: &str) -> Option<SessionRec>;
    fn session_put(&self, s: &SessionRec);
    fn session_del(&self, token: &str);
    fn team_get(&self, id: &str) -> Option<Team>;
    fn team_put(&self, t: &Team);
    fn team_by_code(&self, code_sha: &str) -> Option<Team>;
    fn all_teams(&self, email: &str) -> Vec<Team>;
    fn files_for(&self, team_id: &str) -> Vec<TeamFile>;
    fn file_get(&self, team_id: &str, file_id: &str) -> Option<TeamFile>;
    fn file_put(&self, f: &TeamFile);
    fn ops_get(&self, site_key: &str) -> Option<String>;
    fn ops_put(&self, site_key: &str, data: &str);
}

// ---------- responses ----------

pub struct Resp {
    pub status: u16,
    pub body: Value,
}

impl Resp {
    pub fn ok(body: Value) -> Resp {
        Resp { status: 200, body }
    }
    pub fn err(status: u16, msg: &str) -> Resp {
        Resp { status, body: json!({"error": msg}) }
    }
}

fn hash_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

fn normalize_email(e: &str) -> String {
    e.trim().to_lowercase()
}

fn normalize_code(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_uppercase()
}

pub fn random_code() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let mut raw = String::new();
    for _ in 0..8 {
        raw.push(CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char);
    }
    format!("{}-{}", &raw[0..4], &raw[4..8])
}

pub fn random_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

pub fn now_ts() -> i64 {
    chrono::Utc::now().timestamp()
}

fn hash_password(pw: &str) -> Result<String, Resp> {
    let salt = random_token();
    let mut out = vec![0u8; 32];
    Argon2::default()
        .hash_password_into(pw.as_bytes(), salt.as_bytes(), &mut out)
        .map_err(|_| Resp::err(500, "hash failed"))?;
    Ok(format!("{}:{}", salt, hex::encode(out)))
}

fn verify_password(pw: &str, stored: &str) -> bool {
    let Some((salt, hex_hash)) = stored.split_once(':') else { return false };
    if salt.len() < 16 {
        return false;
    }
    let Ok(raw_hash) = hex::decode(hex_hash) else { return false };
    let mut out = vec![0u8; raw_hash.len()];
    Argon2::default()
        .hash_password_into(pw.as_bytes(), salt.as_bytes(), &mut out)
        .map(|_| out == raw_hash)
        .unwrap_or(false)
}

fn bearer_token(auth: &str) -> Option<String> {
    auth.strip_prefix("Bearer ").map(|s| s.trim().to_string())
}

fn session_ok(store: &dyn Store, auth: &str) -> Result<SessionRec, Resp> {
    let token = bearer_token(auth).ok_or_else(|| Resp::err(401, "missing token"))?;
    let s = store
        .session_get(&token)
        .ok_or_else(|| Resp::err(401, "session expired or invalid"))?;
    let ts = now_ts();
    if s.expiry_ts <= ts {
        let _ = s;
        store.session_del(&token);
        return Err(Resp::err(401, "session expired"));
    }
    Ok(s)
}

fn role_in(team: &Team, email: &str) -> Option<String> {
    team.members.get(email).cloned()
}

fn team_of(
    store: &dyn Store,
    session: &SessionRec,
    team_id: &str,
) -> Result<Team, Resp> {
    let team = store
        .team_get(team_id)
        .ok_or_else(|| Resp::err(404, "team not found"))?;
    if !team.members.contains_key(&session.email) {
        return Err(Resp::err(403, "not a member of this team"));
    }
    Ok(team)
}

// ---------- handlers ----------

fn h_register(store: &dyn Store, email: &str, name: &str, password: &str) -> Resp {
    let email = normalize_email(email);
    if email.len() < 3 || email.len() > 254 || !email.contains('@') {
        return Resp::err(400, "invalid email");
    }
    if password.len() < 8 {
        return Resp::err(400, "password must be at least 8 characters");
    }
    if store.user_get(&email).is_some() {
        return Resp::err(409, "account already exists");
    }
    let pw = match hash_password(password) {
        Ok(p) => p,
        Err(r) => return r,
    };
    let user = User {
        email: email.clone(),
        nm: if name.trim().is_empty() { email.clone() } else { name.trim().to_string() },
        pw,
        created_ts: now_ts(),
    };
    store.user_put(&user);
    let session = SessionRec {
        token: random_token(),
        email,
        expiry_ts: now_ts() + SESSION_SECS,
    };
    store.session_put(&session);
    Resp::ok(json!({
        "token": session.token,
        "email": session.email,
        "name": user.nm,
        "teams": []
    }))
}

fn h_login(store: &dyn Store, email: &str, password: &str) -> Resp {
    let email = normalize_email(email);
    let user = store.user_get(&email);
    let Some(user) = user else {
        return Resp::err(401, "wrong email or password");
    };
    if !verify_password(password, &user.pw) {
        return Resp::err(401, "wrong email or password");
    }
    let session = SessionRec {
        token: random_token(),
        email,
        expiry_ts: now_ts() + SESSION_SECS,
    };
    store.session_put(&session);
    Resp::ok(json!({
        "token": session.token,
        "email": session.email,
        "name": user.nm,
    }))
}

fn h_logout(store: &dyn Store, auth: &str) -> Resp {
    if let Some(token) = bearer_token(auth) {
        store.session_del(&token);
    }
    Resp::ok(json!({"ok": true}))
}

fn h_me(store: &dyn Store, auth: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let user = store.user_get(&session.email).unwrap_or(User {
        email: session.email.clone(),
        nm: session.email.clone(),
        pw: String::new(),
        created_ts: 0,
    });
    let mut teams = Vec::new();
    for mut team in store.all_teams(&session.email) {
        let is_owner = team.owner == session.email;
        let mut code: Option<String> = None;
        if is_owner {
            let now = now_ts();
            if team.code_ts + CODE_LIFE_SECS <= now {
                let fresh = random_code();
                team.code_sha = hash_hex(&fresh);
                team.code_ts = now;
                code = Some(fresh);
                store.team_put(&team);
            } else {
                code = Some(team.code.clone());
            }
        }
        teams.push(json!({
            "team_id": team.team_id,
            "name": team.nm,
            "role": team.members.get(&session.email),
            "code": code,
        }));
    }
    Resp::ok(json!({
        "email": session.email,
        "name": user.nm,
        "teams": teams,
    }))
}

fn h_team_create(store: &dyn Store, auth: &str, name: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let name = name.trim();
    if name.is_empty() || name.len() > 60 {
        return Resp::err(400, "team name required (max 60 chars)");
    }
    let team_id = uuid::Uuid::new_v4().to_string();
    let code = normalize_code(&random_code());
    let mut members = HashMap::new();
    members.insert(session.email.clone(), ROLE_OWNER.to_string());
    let team = Team {
        team_id: team_id.clone(),
        nm: name.to_string(),
        owner: session.email.clone(),
        members,
        code: code.clone(),
        code_sha: hash_hex(&code),
        code_ts: now_ts(),
        created_ts: now_ts(),
    };
    store.team_put(&team);
    Resp::ok(json!({
        "team_id": team.team_id,
        "name": team.nm,
        "code": code,
        "role": ROLE_OWNER,
    }))
}

fn h_team_join(store: &dyn Store, auth: &str, code: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let code = normalize_code(code);
    if code.len() != 8 {
        return Resp::err(400, "invalid code");
    }
    let mut team = match store.team_by_code(&hash_hex(&code)) {
        Some(t) => t,
        None => return Resp::err(404, "code not found"),
    };
    let now = now_ts();
    if team.code_ts + CODE_LIFE_SECS <= now {
        return Resp::err(410, "code expired");
    }
    if !team.members.contains_key(&session.email) {
        team.members.insert(session.email.clone(), ROLE_FULL.to_string());
        store.team_put(&team);
    }
    Resp::ok(json!({
        "team_id": team.team_id,
        "name": team.nm,
        "role": team.members.get(&session.email),
    }))
}

fn h_code_rotate(store: &dyn Store, auth: &str, team_id: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    if team.owner != session.email {
        return Resp::err(403, "only the team creator can rotate the code");
    }
    let code = normalize_code(&random_code());
    let mut team = team;
    team.code = code.clone();
    team.code_sha = hash_hex(&code);
    team.code_ts = now_ts();
    store.team_put(&team);
    Resp::ok(json!({"code": code}))
}

fn h_team_members(store: &dyn Store, auth: &str, team_id: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    let mut people = Vec::new();
    for (email, role) in &team.members {
        let name = store
            .user_get(email)
            .map(|u| u.nm)
            .unwrap_or_else(|| email.clone());
        people.push(json!({"email": email, "name": name, "role": role}));
    }
    Resp::ok(json!({"members": people}))
}

fn h_member_role(store: &dyn Store, auth: &str, team_id: &str, email: &str, role: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    if team.owner != session.email {
        return Resp::err(403, "only the team creator can set permissions");
    }
    let email = normalize_email(email);
    if email == team.owner {
        return Resp::err(400, "cannot change the team creator's role");
    }
    if !team.members.contains_key(&email) {
        return Resp::err(404, "not a member of this team");
    }
    if role != ROLE_FULL && role != ROLE_VIEWER {
        return Resp::err(400, "role must be 'full' or 'viewer'");
    }
    let mut team = team;
    team.members.insert(email, role.to_string());
    store.team_put(&team);
    Resp::ok(json!({"ok": true}))
}

fn h_files_list(store: &dyn Store, auth: &str, team_id: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(_team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    let files: Vec<Value> = store
        .files_for(team_id)
        .into_iter()
        .filter(|f| f.done)
        .map(|f| {
            json!({
                "file_id": f.file_id,
                "name": f.nm,
                "size": f.size,
                "published_by": f.pub_by,
                "created_ts": f.created_ts,
            })
        })
        .collect();
    Resp::ok(json!({"files": files}))
}

fn h_file_upload_url(store: &dyn Store, auth: &str, team_id: &str, name: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    if team.owner != session.email {
        return Resp::err(403, "only the team creator can publish files");
    }
    let name = name.trim();
    if name.is_empty() || name.len() > 120 {
        return Resp::err(400, "file name required");
    }
    let file_id = uuid::Uuid::new_v4().to_string();
    let s3_key = format!("team/{}/file/{}.db", team_id, file_id);
    let f = TeamFile {
        team_id: team_id.to_string(),
        file_id: file_id.clone(),
        nm: name.to_string(),
        s3_key: s3_key.clone(),
        size: 0,
        created_ts: now_ts(),
        pub_by: session.email.clone(),
        done: false,
        sites: Vec::new(),
        schema: String::new(),
    };
    store.file_put(&f);
    let url = crate::s3::upload_url(&s3_key, team_id);
    Resp::ok(json!({
        "file_id": file_id,
        "name": name,
        "upload_url": url,
    }))
}

fn h_file_confirm(store: &dyn Store, auth: &str, team_id: &str, file_id: &str, size: i64) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    if team.owner != session.email {
        return Resp::err(403, "only the team creator can publish files");
    }
    let Some(mut f) = store.file_get(team_id, file_id) else {
        return Resp::err(404, "file not found");
    };
    if f.team_id != team_id {
        return Resp::err(404, "file not found");
    }
    f.done = true;
    f.size = size.max(0);
    f.pub_by = session.email.clone();
    store.file_put(&f);
    Resp::ok(json!({"ok": true}))
}

fn h_file_download(store: &dyn Store, auth: &str, team_id: &str, file_id: &str) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(_team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    let Some(f) = store.file_get(team_id, file_id) else {
        return Resp::err(404, "file not found");
    };
    if !f.done {
        return Resp::err(404, "file not ready");
    }
    Resp::ok(json!({"download_url": crate::s3::download_url(&f.s3_key)}))
}

// ---------- sync ----------

fn op_cursor(op: &Value) -> (String, String, i64) {
    (
        op.get("hlc").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        op.get("site").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        op.get("seq").and_then(|v| v.as_i64()).unwrap_or(0),
    )
}

fn site_key(team_id: &str, file_id: &str, site: &str) -> String {
    format!("{}|{}|{}", team_id, file_id, site)
}

fn h_push(
    store: &dyn Store,
    auth: &str,
    team_id: &str,
    file_id: &str,
    site: &str,
    schema: &str,
    ops: &[Value],
) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    let role = role_in(&team, &session.email).unwrap_or_default();
    if role == ROLE_VIEWER {
        return Resp::err(403, "viewer cannot push changes");
    }
    let Some(file) = store.file_get(team_id, file_id) else {
        return Resp::err(404, "file not found");
    };
    if !file.done {
        return Resp::err(404, "file not ready");
    }
    if site.trim().is_empty() {
        return Resp::err(400, "site required");
    }
    if ops.is_empty() && schema.is_empty() {
        return Resp::ok(json!({"ok": true}));
    }

    let key = site_key(team_id, file_id, site);
    let mut data = store.ops_get(&key).unwrap_or_default();
    let mut max_seq = 0i64;
    for line in data.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(line) {
            if let Some(s) = v.get("seq").and_then(|x| x.as_i64()) {
                if s > max_seq {
                    max_seq = s;
                }
            }
        }
    }
    let mut added = String::new();
    for op in ops {
        let seq = op.get("seq").and_then(|v| v.as_i64()).unwrap_or(0);
        if seq > max_seq {
            added.push_str(&op.to_string());
            added.push('\n');
        }
    }
    if !added.is_empty() {
        if data.len() + added.len() > OPS_MAX_CHARS {
            return Resp::err(507, "ops log full; contact your team creator");
        }
        data.push_str(&added);
        store.ops_put(&key, &data);
    }

    let mut file = file;
    if !schema.is_empty() && file.schema != schema {
        file.schema = schema.to_string();
    }
    if !file.sites.contains(&site.to_string()) {
        file.sites.push(site.to_string());
    }
    store.file_put(&file);
    Resp::ok(json!({"ok": true}))
}

fn h_pull(
    store: &dyn Store,
    auth: &str,
    team_id: &str,
    file_id: &str,
    site: &str,
    h: &str,
    seq: i64,
    wait_ms: u64,
) -> Resp {
    let Ok(session) = session_ok(store, auth) else {
        return Resp::err(401, "not logged in");
    };
    let Ok(_team) = team_of(store, &session, team_id) else {
        return Resp::err(403, "not a member");
    };
    let Some(file) = store.file_get(team_id, file_id) else {
        return Resp::err(404, "file not found");
    };

    let collect = |store: &dyn Store| -> Vec<Value> {
        let mut ops = Vec::new();
        for f in store.files_for(team_id) {
            if f.file_id != file_id {
                continue;
            }
            for s in &f.sites {
                if let Some(data) = store.ops_get(&site_key(team_id, file_id, s)) {
                    for line in data.lines() {
                        if let Ok(op) = serde_json::from_str::<Value>(line) {
                            let (oh, os, oseq) = op_cursor(&op);
                            if oh.as_str() > h
                                || (oh == h && (os.as_str() > site || (os == site && oseq > seq)))
                            {
                                ops.push(op);
                            }
                        }
                    }
                }
            }
        }
        ops.sort_by(|a, b| {
            op_cursor(a)
                .cmp(&op_cursor(b))
        });
        ops.truncate(PULL_LIMIT);
        ops
    };

    let wait_ms = wait_ms.min(12_000);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(wait_ms);
    let mut ops = collect(store);
    while ops.is_empty() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(400));
        ops = collect(store);
    }

    Resp::ok(json!({
        "ops": ops,
        "sites": file.sites,
        "schema": file.schema,
    }))
}

// ---------- router ----------

pub fn route(store: &dyn Store, method: &str, path: &str, auth: &str, body: &Value) -> Resp {
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    match (method, segs.as_slice()) {
        ("GET", ["api", "v1", "health"]) => Resp::ok(json!({"ok": true})),
        ("POST", ["api", "v1", "register"]) => {
            let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");
            let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let pw = body.get("password").and_then(|v| v.as_str()).unwrap_or("");
            h_register(store, email, name, pw)
        }
        ("POST", ["api", "v1", "login"]) => {
            let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");
            let pw = body.get("password").and_then(|v| v.as_str()).unwrap_or("");
            h_login(store, email, pw)
        }
        ("POST", ["api", "v1", "logout"]) => h_logout(store, auth),
        ("GET", ["api", "v1", "me"]) => h_me(store, auth),
        ("POST", ["api", "v1", "team", "create"]) => {
            let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
            h_team_create(store, auth, name)
        }
        ("POST", ["api", "v1", "team", "join"]) => {
            let code = body.get("code").and_then(|v| v.as_str()).unwrap_or("");
            h_team_join(store, auth, code)
        }
        ("POST", ["api", "v1", "code", "rotate"]) => {
            let team_id = body.get("team_id").and_then(|v| v.as_str()).unwrap_or("");
            h_code_rotate(store, auth, team_id)
        }
        ("GET", ["api", "v1", "team", "members"]) => {
            h_team_members(store, auth, query_param(body, "team_id"))
        }
        ("POST", ["api", "v1", "team", "members"]) => {
            let team_id = body.get("team_id").and_then(|v| v.as_str()).unwrap_or("");
            let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");
            let role = body.get("role").and_then(|v| v.as_str()).unwrap_or("");
            h_member_role(store, auth, team_id, email, role)
        }
        ("GET", ["api", "v1", "files"]) => {
            h_files_list(store, auth, query_param(body, "team_id"))
        }
        ("POST", ["api", "v1", "files", "upload-url"]) => {
            let team_id = body.get("team_id").and_then(|v| v.as_str()).unwrap_or("");
            let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");
            h_file_upload_url(store, auth, team_id, name)
        }
        ("POST", ["api", "v1", "files", "confirm"]) => {
            let team_id = body.get("team_id").and_then(|v| v.as_str()).unwrap_or("");
            let file_id = body.get("file_id").and_then(|v| v.as_str()).unwrap_or("");
            let size = body.get("size").and_then(|v| v.as_i64()).unwrap_or(0);
            h_file_confirm(store, auth, team_id, file_id, size)
        }
        ("POST", ["api", "v1", "files", "download"]) => {
            let team_id = body.get("team_id").and_then(|v| v.as_str()).unwrap_or("");
            let file_id = body.get("file_id").and_then(|v| v.as_str()).unwrap_or("");
            h_file_download(store, auth, team_id, file_id)
        }
        ("POST", ["api", "v1", "push"]) => {
            let team_id = body.get("team_id").and_then(|v| v.as_str()).unwrap_or("");
            let file_id = body.get("file_id").and_then(|v| v.as_str()).unwrap_or("");
            let site = body.get("site").and_then(|v| v.as_str()).unwrap_or("");
            let schema = body.get("schema").and_then(|v| v.as_str()).unwrap_or("");
            let ops = body.get("ops").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            h_push(store, auth, team_id, file_id, site, schema, &ops)
        }
        ("GET", ["api", "v1", "pull"]) => {
            let team_id = query_param(body, "team_id");
            let file_id = query_param(body, "file_id");
            let site = query_param(body, "site");
            let h = query_param(body, "h");
            let seq = body.get("seq").and_then(|v| v.as_i64()).unwrap_or(0);
            let wait = body.get("wait").and_then(|v| v.as_u64()).unwrap_or(0);
            h_pull(store, auth, team_id, file_id, site, h, seq, wait)
        }
        _ => Resp::err(404, "not found"),
    }
}

fn query_param<'a>(body: &'a Value, key: &str) -> &'a str {
    body.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

// ---------- memory store (tests) ----------

#[cfg(test)]
pub struct MemoryStore {
    inner: Mutex<Mem>,
}

#[cfg(test)]
struct Mem {
    users: HashMap<String, User>,
    sessions: HashMap<String, SessionRec>,
    teams: HashMap<String, Team>,
    files: HashMap<String, TeamFile>,
    ops: HashMap<String, String>,
}

#[cfg(test)]
impl MemoryStore {
    pub fn new() -> Self {
        MemoryStore {
            inner: Mutex::new(Mem {
                users: HashMap::new(),
                sessions: HashMap::new(),
                teams: HashMap::new(),
                files: HashMap::new(),
                ops: HashMap::new(),
            }),
        }
    }
}

#[cfg(test)]
impl Store for MemoryStore {
    fn user_get(&self, email: &str) -> Option<User> {
        self.inner.lock().unwrap().users.get(email).cloned()
    }
    fn user_put(&self, u: &User) {
        self.inner.lock().unwrap().users.insert(u.email.clone(), u.clone());
    }
    fn session_get(&self, token: &str) -> Option<SessionRec> {
        self.inner.lock().unwrap().sessions.get(token).cloned()
    }
    fn session_put(&self, s: &SessionRec) {
        self.inner.lock().unwrap().sessions.insert(s.token.clone(), s.clone());
    }
    fn session_del(&self, token: &str) {
        self.inner.lock().unwrap().sessions.remove(token);
    }
    fn team_get(&self, id: &str) -> Option<Team> {
        self.inner.lock().unwrap().teams.get(id).cloned()
    }
    fn team_put(&self, t: &Team) {
        self.inner.lock().unwrap().teams.insert(t.team_id.clone(), t.clone());
    }
    fn team_by_code(&self, code_sha: &str) -> Option<Team> {
        self.inner
            .lock()
            .unwrap()
            .teams
            .values()
            .find(|t| t.code_sha == code_sha)
            .cloned()
    }
    fn all_teams(&self, email: &str) -> Vec<Team> {
        self.inner
            .lock()
            .unwrap()
            .teams
            .values()
            .filter(|t| t.members.contains_key(email))
            .cloned()
            .collect()
    }
    fn files_for(&self, team_id: &str) -> Vec<TeamFile> {
        self.inner
            .lock()
            .unwrap()
            .files
            .values()
            .filter(|f| f.team_id == team_id)
            .cloned()
            .collect()
    }
    fn file_get(&self, team_id: &str, file_id: &str) -> Option<TeamFile> {
        self.inner
            .lock()
            .unwrap()
            .files
            .get(&format!("{}|{}", team_id, file_id))
            .cloned()
    }
    fn file_put(&self, f: &TeamFile) {
        self.inner
            .lock()
            .unwrap()
            .files
            .insert(format!("{}|{}", f.team_id, f.file_id), f.clone());
    }
    fn ops_get(&self, site_key: &str) -> Option<String> {
        self.inner.lock().unwrap().ops.get(site_key).cloned()
    }
    fn ops_put(&self, site_key: &str, data: &str) {
        self.inner.lock().unwrap().ops.insert(site_key.to_string(), data.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(store: &MemoryStore, m: &str, p: &str, token: Option<&str>, body: Value) -> Resp {
        let auth = token.map(|t| format!("Bearer {}", t)).unwrap_or_default();
        route(store, m, p, &auth, &body)
    }

    fn op(site: &str, seq: i64, hlc: &str, table: &str) -> Value {
        json!({
            "site": site, "seq": seq, "hlc": hlc, "table": table,
            "pk": {"id": 1}, "row": {"name": format!("{}-{}", site, seq)}, "op": "upsert"
        })
    }

    #[test]
    fn multi_op_push_batch() {
        let s = MemoryStore::new();
        let r = req(&s, "POST", "/api/v1/register", None, json!({"email":"owner@x.com","password":"secret123"}));
        let owner_token = r.body["token"].as_str().unwrap().to_string();
        let r = req(&s, "POST", "/api/v1/team/create", Some(&owner_token), json!({"name":"Wine Shop"}));
        assert_eq!(r.status, 200);
        let team_id = r.body["team_id"].as_str().unwrap().to_string();
        let r = req(&s, "POST", "/api/v1/files/upload-url", Some(&owner_token), json!({"team_id": team_id, "name": "inventory.db"}));
        assert_eq!(r.status, 200);
        let file_id = r.body["file_id"].as_str().unwrap().to_string();
        let r = req(&s, "POST", "/api/v1/files/confirm", Some(&owner_token), json!({"team_id": team_id, "file_id": file_id, "size": 1234}));
        assert_eq!(r.status, 200);

        let r = req(&s, "POST", "/api/v1/push", Some(&owner_token), json!({
            "team_id": team_id, "file_id": file_id, "site": "mac-a", "schema": "",
            "ops": [
                json!({"site":"mac-a","seq":14,"hlc":"20260811045336.382","table_name":"inventory_logs","pk":{"id":10},"row":{"id":10,"batch_id":4,"provider_id":null,"quantity_change":1,"transaction_type":"PURCHASE","notes":null,"created_at":"2026-08-11 12:53:36","log_date":"2026-08-11"},"op":"upsert"}),
                json!({"site":"mac-a","seq":15,"hlc":"20260811045336.529","table_name":"inventory_logs","pk":{"id":11},"row":{"id":11,"batch_id":4,"provider_id":null,"quantity_change":1,"transaction_type":"PURCHASE","notes":null,"created_at":"2026-08-11 12:53:36","log_date":"2026-08-11"},"op":"upsert"}),
            ]
        }));
        assert_eq!(r.status, 200, "multi-op push must succeed: {:?}", r.body);

        let r = req(&s, "GET", "/api/v1/pull", Some(&owner_token), json!({
            "team_id": team_id, "file_id": file_id, "site": "", "h": "", "seq": 0, "wait": 0
        }));
        assert_eq!(r.status, 200);
        assert_eq!(r.body["ops"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn auth_flows() {
        let s = MemoryStore::new();
        let r = req(&s, "POST", "/api/v1/register", None, json!({"email":"a@x.com","name":"Alice","password":"secret123"}));
        assert_eq!(r.status, 200);
        let token = r.body["token"].as_str().unwrap().to_string();

        let r = req(&s, "POST", "/api/v1/login", None, json!({"email":"a@x.com","password":"secret123"}));
        assert_eq!(r.status, 200);

        let r = req(&s, "POST", "/api/v1/login", None, json!({"email":"a@x.com","password":"wrong"}));
        assert_eq!(r.status, 401);

        let r = req(&s, "GET", "/api/v1/me", Some(&token), json!({}));
        assert_eq!(r.status, 200);
        assert_eq!(r.body["email"], "a@x.com");

        let r = req(&s, "POST", "/api/v1/logout", Some(&token), json!({}));
        assert_eq!(r.status, 200);
        let r = req(&s, "GET", "/api/v1/me", Some(&token), json!({}));
        assert_eq!(r.status, 401);
    }

    #[test]
    fn full_team_sync_flow() {
        let s = MemoryStore::new();
        let r = req(&s, "POST", "/api/v1/register", None, json!({"email":"owner@x.com","password":"secret123"}));
        let owner_token = r.body["token"].as_str().unwrap().to_string();
        let r = req(&s, "POST", "/api/v1/register", None, json!({"email":"member@x.com","password":"secret123"}));
        let member_token = r.body["token"].as_str().unwrap().to_string();

        let r = req(&s, "POST", "/api/v1/team/create", Some(&owner_token), json!({"name":"Wine Shop"}));
        assert_eq!(r.status, 200);
        let team_id = r.body["team_id"].as_str().unwrap().to_string();
        let code = r.body["code"].as_str().unwrap().to_string();

        let r = req(&s, "GET", "/api/v1/me", Some(&owner_token), json!({}));
        assert_eq!(r.body["teams"].as_array().unwrap().len(), 1);

        let r = req(&s, "POST", "/api/v1/team/join", Some(&member_token), json!({"code": code}));
        assert_eq!(r.status, 200);
        assert_eq!(r.body["role"], "full");

        // owner publishes a file
        let r = req(&s, "POST", "/api/v1/files/upload-url", Some(&owner_token), json!({"team_id": team_id, "name": "inventory.db"}));
        assert_eq!(r.status, 200);
        let file_id = r.body["file_id"].as_str().unwrap().to_string();
        let r = req(&s, "POST", "/api/v1/files/confirm", Some(&owner_token), json!({"team_id": team_id, "file_id": file_id, "size": 1234}));
        assert_eq!(r.status, 200);

        // owner pushes
        let r = req(&s, "POST", "/api/v1/push", Some(&owner_token), json!({
            "team_id": team_id, "file_id": file_id, "site": "mac-a", "schema": "k1",
            "ops": [op("mac-a", 1, "260800000000.001", "products")]
        }));
        assert_eq!(r.status, 200);

        // member pulls and sees it
        let r = req(&s, "GET", "/api/v1/pull", Some(&member_token), json!({
            "team_id": team_id, "file_id": file_id, "site": "", "h": "", "seq": 0, "wait": 0
        }));
        assert_eq!(r.status, 200);
        assert_eq!(r.body["ops"].as_array().unwrap().len(), 1);
        assert_eq!(r.body["schema"], "k1");

        // member pushes own op
        let r = req(&s, "POST", "/api/v1/push", Some(&member_token), json!({
            "team_id": team_id, "file_id": file_id, "site": "tablet", "schema": "",
            "ops": [op("tablet", 1, "260800000000.002", "products")]
        }));
        assert_eq!(r.status, 200);

        // viewer cannot push
        let r = req(&s, "POST", "/api/v1/team/members", Some(&owner_token), json!({"team_id": team_id, "email": "member@x.com", "role": "viewer"}));
        assert_eq!(r.status, 200);
        let r = req(&s, "POST", "/api/v1/push", Some(&member_token), json!({
            "team_id": team_id, "file_id": file_id, "site": "tablet", "schema": "",
            "ops": [op("tablet", 2, "260800000000.003", "products")]
        }));
        assert_eq!(r.status, 403);
        let r = req(&s, "GET", "/api/v1/pull", Some(&member_token), json!({
            "team_id": team_id, "file_id": file_id, "site": "", "h": "", "seq": 0, "wait": 0
        }));
        assert_eq!(r.status, 200);

        // code rotate only for owner
        let r = req(&s, "POST", "/api/v1/code/rotate", Some(&member_token), json!({"team_id": team_id}));
        assert_eq!(r.status, 403);
        let r = req(&s, "POST", "/api/v1/code/rotate", Some(&owner_token), json!({"team_id": team_id}));
        assert_eq!(r.status, 200);
        assert_eq!(r.body["code"].as_str().unwrap().len(), 8);
    }
}