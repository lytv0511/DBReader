use crate::api::{SessionRec, Store, Team, TeamFile, User};
use crate::ddb::Ddb;
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct DdbStore {
    ddb: Ddb,
    users_table: String,
    sessions_table: String,
    teams_table: String,
    files_table: String,
    ops_table: String,
}

impl DdbStore {
    pub fn new() -> DdbStore {
        DdbStore {
            ddb: Ddb::new(),
            users_table: std::env::var("USERS_TABLE").unwrap_or_else(|_| "dbreader-users".into()),
            sessions_table: std::env::var("SESSIONS_TABLE")
                .unwrap_or_else(|_| "dbreader-sessions".into()),
            teams_table: std::env::var("TEAMS_TABLE").unwrap_or_else(|_| "dbreader-teams".into()),
            files_table: std::env::var("FILES_TABLE").unwrap_or_else(|_| "dbreader-files".into()),
            ops_table: std::env::var("OPS_TABLE").unwrap_or_else(|_| "dbreader-ops".into()),
        }
    }

    fn get_user(&self, email: &str) -> Option<Value> {
        self.ddb
            .get_item(&self.users_table, &[("user_id", json!({"S": email}))])
            .ok()
            .flatten()
            .map(item_to_value)
    }
    fn get_session(&self, token: &str) -> Option<Value> {
        self.ddb
            .get_item(&self.sessions_table, &[("token", json!({"S": token}))])
            .ok()
            .flatten()
            .map(item_to_value)
    }
    fn get_team(&self, team_id: &str) -> Option<Value> {
        self.ddb
            .get_item(&self.teams_table, &[("team_id", json!({"S": team_id}))])
            .ok()
            .flatten()
            .map(item_to_value)
    }
    fn get_file(&self, team_id: &str, file_id: &str) -> Option<Value> {
        self.ddb
            .get_item(
                &self.files_table,
                &[
                    ("team_id", json!({"S": team_id})),
                    ("file_id", json!({"S": file_id})),
                ],
            )
            .ok()
            .flatten()
            .map(item_to_value)
    }

    fn item_team(&self, v: &Value) -> Option<Team> {
        let members = match v.get("members").and_then(|x| x.get("M")) {
            Some(Value::Object(m)) => {
                let mut map = HashMap::new();
                for (k, vv) in m {
                    if let Some(s) = vv.get("S").and_then(|x| x.as_str()) {
                        map.insert(k.clone(), s.to_string());
                    }
                }
                map
            }
            _ => HashMap::new(),
        };
        Some(Team {
            team_id: s(&v, "team_id")?,
            nm: s(&v, "nm")?,
            owner: s(&v, "owner")?,
            members,
            code: s(&v, "code").unwrap_or_default(),
            code_sha: s(&v, "code_sha").unwrap_or_default(),
            code_ts: v.get("code_ts").and_then(|x| x.get("N")).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0),
            created_ts: v.get("created_ts").and_then(|x| x.get("N")).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0),
        })
    }

    fn item_file(&self, v: &Value) -> Option<TeamFile> {
        let sites: Vec<String> = match v.get("sites").and_then(|x| x.get("M")) {
            Some(Value::Object(m)) => m
                .values()
                .filter_map(|x| x.get("S").and_then(|s| s.as_str()))
                .map(|s| s.to_string())
                .collect(),
            _ => Vec::new(),
        };
        let schema = s(&v, "schema").unwrap_or_default();
        Some(TeamFile {
            team_id: s(&v, "team_id")?,
            file_id: s(&v, "file_id")?,
            nm: s(&v, "nm")?,
            s3_key: s(&v, "s3_key")?,
            size: v.get("size").and_then(|x| x.get("N")).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0),
            created_ts: v.get("created_ts").and_then(|x| x.get("N")).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0),
            pub_by: s(&v, "pub_by")?,
            done: v.get("done").and_then(|x| x.get("BOOL")).and_then(|x| x.as_bool()).unwrap_or(false),
            sites,
            schema,
        })
    }
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k)
        .and_then(|x| x.get("S"))
        .and_then(|x| x.as_str())
        .map(|x| x.to_string())
}

fn item_to_value(item: crate::ddb::Item) -> Value {
    Value::Object(item.into_iter().collect())
}

impl Store for DdbStore {
    fn user_get(&self, email: &str) -> Option<User> {
        let v = self.get_user(email)?;
        Some(User {
            email: s(&v, "user_id")?,
            nm: s(&v, "nm").unwrap_or_default(),
            pw: s(&v, "pw")?,
            created_ts: v.get("created_ts").and_then(|x| x.get("N")).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0),
        })
    }

    fn user_by_name(&self, name: &str) -> Option<User> {
        let want = name.to_lowercase();
        let items = self.ddb.scan(&self.users_table, "", &[]).ok()?;
        items
            .into_iter()
            .map(item_to_value)
            .filter_map(|v| {
                Some(User {
                    email: s(&v, "user_id")?,
                    nm: s(&v, "nm")?,
                    pw: s(&v, "pw")?,
                    created_ts: v.get("created_ts").and_then(|x| x.get("N")).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0),
                })
            })
            .find(|u| u.nm.to_lowercase() == want)
    }

    fn user_put(&self, u: &User) {
        let _ = self.ddb.put_item(
            &self.users_table,
            &[
                ("user_id".into(), json!({"S": u.email})),
                ("nm".into(), json!({"S": u.nm})),
                ("pw".into(), json!({"S": u.pw})),
                ("created_ts".into(), json!({"N": u.created_ts.to_string()})),
            ],
        );
    }

    fn session_get(&self, token: &str) -> Option<SessionRec> {
        let v = self.get_session(token)?;
        Some(SessionRec {
            token: token.to_string(),
            email: s(&v, "email")?,
            expiry_ts: v.get("expiry_ts").and_then(|x| x.get("N")).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).unwrap_or(0),
        })
    }

    fn session_put(&self, s: &SessionRec) {
        let _ = self.ddb.put_item(
            &self.sessions_table,
            &[
                ("token".into(), json!({"S": s.token})),
                ("email".into(), json!({"S": s.email})),
                ("expiry_ts".into(), json!({"N": s.expiry_ts.to_string()})),
            ],
        );
    }

    fn session_del(&self, token: &str) {
        let _ = self.ddb.delete_item(&self.sessions_table, &[("token", json!({"S": token}))]);
    }

    fn file_del(&self, team_id: &str, file_id: &str) {
        let _ = self.ddb.delete_item(
            &self.files_table,
            &[
                ("team_id", json!({"S": team_id})),
                ("file_id", json!({"S": file_id})),
            ],
        );
    }

    fn team_get(&self, id: &str) -> Option<Team> {
        self.item_team(&self.get_team(id)?)
    }

    fn team_put(&self, t: &Team) {
        let mut attrs = vec![
            ("team_id".into(), json!({"S": t.team_id})),
            ("nm".into(), json!({"S": t.nm})),
            ("owner".into(), json!({"S": t.owner})),
            ("code".into(), json!({"S": t.code})),
            ("code_sha".into(), json!({"S": t.code_sha})),
            ("code_ts".into(), json!({"N": t.code_ts.to_string()})),
            ("created_ts".into(), json!({"N": t.created_ts.to_string()})),
        ];
        if !t.members.is_empty() {
            let mut members = json!({});
            if let Value::Object(m) = &mut members {
                for (email, role) in &t.members {
                    m.insert(email.clone(), json!({"S": role}));
                }
            }
            attrs.push(("members".into(), json!({"M": members})));
        }
        let _ = self.ddb.put_item(&self.teams_table, &attrs);
    }

    fn team_by_code(&self, code_sha: &str) -> Option<Team> {
        let items = self
            .ddb
            .scan(
                &self.teams_table,
                "code_sha = :c",
                &[(":c", json!({"S": code_sha}))],
            )
            .ok();
        items.and_then(|items| {
            items
                .into_iter()
                .map(item_to_value)
                .find_map(|v| self.item_team(&v))
        })
    }

    fn all_teams(&self, email: &str) -> Vec<Team> {
        let items = self.ddb.scan(&self.teams_table, "", &[]).ok();
        match items {
            Some(items) => items
                .into_iter()
                .map(item_to_value)
                .filter_map(|v| self.item_team(&v))
                .filter(|t| t.members.contains_key(email))
                .collect(),
            None => Vec::new(),
        }
    }

    fn files_for(&self, team_id: &str) -> Vec<TeamFile> {
        let items = self
            .ddb
            .query(
                &self.files_table,
                "team_id = :t",
                &[(":t", json!({"S": team_id}))],
            )
            .ok();
        match items {
            Some(items) => items
                .into_iter()
                .map(item_to_value)
                .filter_map(|v| self.item_file(&v))
                .collect(),
            None => Vec::new(),
        }
    }

    fn file_get(&self, team_id: &str, file_id: &str) -> Option<TeamFile> {
        self.item_file(&self.get_file(team_id, file_id)?)
    }

    fn file_put(&self, f: &TeamFile) {
        let mut attrs = vec![
            ("team_id".into(), json!({"S": f.team_id})),
            ("file_id".into(), json!({"S": f.file_id})),
            ("nm".into(), json!({"S": f.nm})),
            ("s3_key".into(), json!({"S": f.s3_key})),
            ("size".into(), json!({"N": f.size.to_string()})),
            ("created_ts".into(), json!({"N": f.created_ts.to_string()})),
            ("pub_by".into(), json!({"S": f.pub_by})),
            ("done".into(), json!({"BOOL": f.done})),
            ("schema".into(), json!({"S": f.schema.to_string()})),
        ];
        if !f.sites.is_empty() {
            let mut sites = json!({});
            if let Value::Object(m) = &mut sites {
                for (i, s) in f.sites.iter().enumerate() {
                    m.insert(i.to_string(), json!({"S": s}));
                }
            }
            attrs.push(("sites".into(), json!({"M": sites})));
        }
        let _ = self.ddb.put_item(&self.files_table, &attrs);
    }

    fn ops_get(&self, site_key: &str) -> Option<String> {
        let v = self
            .ddb
            .get_item(&self.ops_table, &[("site_key", json!({"S": site_key}))])
            .ok()
            .flatten()
            .map(item_to_value)?;
        s(&v, "data")
    }

    fn ops_put(&self, site_key: &str, data: &str) {
        let _ = self.ddb.put_item(
            &self.ops_table,
            &[
                ("site_key".into(), json!({"S": site_key})),
                ("data".into(), json!({"S": data})),
            ],
        );
    }
}
