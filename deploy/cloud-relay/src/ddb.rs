use crate::sigv4::SigV4;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub type Item = BTreeMap<String, Value>;

pub struct Ddb {
    pub sig: SigV4,
    pub agent: ureq::Agent,
}

#[derive(Debug)]
pub struct DdbError(pub String);

impl std::fmt::Display for DdbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

fn aws_error(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_else(|| body.chars().take(300).collect())
}

fn key_map(key: &[(&str, Value)]) -> BTreeMap<String, Value> {
    key.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
}

fn items_from(resp: &Value) -> Vec<Item> {
    resp.get("Items")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|o| {
                    o.as_object()
                        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                })
                .collect()
        })
        .unwrap_or_default()
}

impl Ddb {
    pub fn new() -> Ddb {
        let region = std::env::var("AWS_REGION").unwrap_or_default();
        Ddb {
            sig: SigV4 {
                access_key: std::env::var("AWS_ACCESS_KEY_ID").unwrap_or_default(),
                secret_key: std::env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_default(),
                session_token: std::env::var("AWS_SESSION_TOKEN").ok(),
                region,
                service: "dynamodb".into(),
            },
            agent: ureq::Agent::config_builder()
                .http_status_as_error(false)
                .build()
                .new_agent(),
        }
    }

    fn call(&self, target: &str, body: Value) -> Result<Value, DdbError> {
        let bytes = serde_json::to_vec(&body).map_err(|e| DdbError(e.to_string()))?;
        let now = chrono::Utc::now();
        let host = format!("dynamodb.{}.amazonaws.com", self.sig.region);
        let (headers, _base) = self.sig.dynamodb(target, &bytes, &now);
        let mut req = self.agent.post(&format!("https://{}/", host));
        for (k, v) in headers {
            if k != "host" {
                req = req.header(&k, &v);
            }
        }
        match req.send(bytes) {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let text = resp
                    .into_body()
                    .read_to_string()
                    .map_err(|e| DdbError(e.to_string()))?;
                if status >= 300 {
                    let err = DdbError(format!("dynamodb {status}: {}", aws_error(&text)));
                    eprintln!("[ddb] {target} failed: {err:?} body={}", text.chars().take(400).collect::<String>());
                    return Err(err);
                }
                serde_json::from_str(&text).map_err(|e| DdbError(format!("bad dynamodb json: {e}")))
            }
            Err(e) => {
                eprintln!("[ddb] {target} transport error: {e:?}");
                Err(DdbError(format!("dynamodb transport: {e}")))
            }
        }
    }

    pub fn get_item(
        &self,
        table: &str,
        key: &[(&str, Value)],
    ) -> Result<Option<Item>, DdbError> {
        let resp = self.call(
            "GetItem",
            json!({ "TableName": table, "Key": key_map(key), "ConsistentRead": true }),
        )?;
        Ok(resp
            .get("Item")
            .and_then(|v| v.as_object())
            .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()))
    }

    pub fn put_item(&self, table: &str, item: &[(&str, Value)]) -> Result<(), DdbError> {
        self.call("PutItem", json!({ "TableName": table, "Item": key_map(item) }))?;
        Ok(())
    }

    pub fn delete_item(&self, table: &str, key: &[(&str, Value)]) -> Result<(), DdbError> {
        self.call("DeleteItem", json!({ "TableName": table, "Key": key_map(key) }))?;
        Ok(())
    }

    pub fn query(
        &self,
        table: &str,
        key_cond: &str,
        values: &[(&str, Value)],
    ) -> Result<Vec<Item>, DdbError> {
        let mut expr_vals = BTreeMap::new();
        for (k, v) in values {
            expr_vals.insert(k.to_string(), v.clone());
        }
        let resp = self.call(
            "Query",
            json!({
                "TableName": table,
                "KeyConditionExpression": key_cond,
                "ExpressionAttributeValues": expr_vals,
            }),
        )?;
        Ok(items_from(&resp))
    }

    pub fn scan(
        &self,
        table: &str,
        filter: &str,
        values: &[(&str, Value)],
    ) -> Result<Vec<Item>, DdbError> {
        let mut expr_vals = BTreeMap::new();
        for (k, v) in values {
            expr_vals.insert(k.to_string(), v.clone());
        }
        let mut body = json!({ "TableName": table });
        if !filter.is_empty() {
            body["FilterExpression"] = json!(filter);
            body["ExpressionAttributeValues"] = json!(expr_vals);
        }
        let resp = self.call("Scan", body)?;
        Ok(items_from(&resp))
    }

    // TODO: use this for atomic member-role changes (avoids lost updates between devices).
    #[allow(dead_code)]
    pub fn update(
        &self,
        table: &str,
        key: &[(&str, Value)],
        update_expr: &str,
        values: Vec<(&str, Value)>,
    ) -> Result<Option<Item>, DdbError> {
        let mut expr_vals = BTreeMap::new();
        for (k, v) in values {
            expr_vals.insert(format!(":{}", k), v);
        }
        let mut body = json!({
            "TableName": table,
            "Key": key_map(key),
            "UpdateExpression": update_expr,
            "ExpressionAttributeValues": expr_vals,
        });
        body["ReturnValues"] = json!("ALL_NEW");
        let resp = self.call("UpdateItem", body)?;
        Ok(resp.get("Attributes").and_then(|v| v.as_object()).map(|o| {
            o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_map_formats_attribute_pairs() {
        let m = key_map(&[("user_id", json!({"S": "a@x.com"})), ("n", json!({"N": "42"}))]);
        assert_eq!(m["user_id"]["S"], "a@x.com");
        assert_eq!(m["n"]["N"], "42");
    }

    #[test]
    fn items_from_extracts_item_objects() {
        let resp = json!({
            "Items": [
                {"team_id": {"S": "t1"}},
                {"team_id": {"S": "t2"}},
                "not-an-object"
            ]
        });
        let items = items_from(&resp);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["team_id"]["S"], "t1");
    }

    #[test]
    fn items_from_empty_when_missing() {
        assert!(items_from(&json!({})).is_empty());
    }
}