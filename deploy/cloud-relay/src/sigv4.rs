use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

pub const UNSIGNED_PAYLOAD: &str = "UNSIGNED-PAYLOAD";

type HmacSha256 = Hmac<Sha256>;

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac key");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

pub fn signing_key(secret: &str, date_stamp: &str, region: &str, service: &str) -> Vec<u8> {
    let k_date = hmac_sha256(format!("AWS4{}", secret).as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    hmac_sha256(&k_service, b"aws4_request")
}

pub fn signature(
    secret: &str,
    region: &str,
    service: &str,
    date_stamp: &str,
    amz_date: &str,
    method: &str,
    path: &str,
    query: &[(String, String)],
    headers: Vec<(String, String)>,
    payload_hash: &str,
) -> String {
    let mut headers = headers;
    headers.sort();
    let canonical_headers = headers
        .iter()
        .map(|(k, v)| format!("{}:{}", k, v.trim()))
        .collect::<Vec<_>>()
        .join("\n");
    let signed_headers = headers
        .iter()
        .map(|(k, _)| k.clone())
        .collect::<Vec<_>>()
        .join(";");
    let qs = canonical_query(query);
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n\n{}\n{}",
        method, path, qs, canonical_headers, signed_headers, payload_hash
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n{}",
        amz_date,
        date_stamp,
        region,
        service,
        sha256_hex(canonical_request.as_bytes())
    );
    let key = signing_key(secret, date_stamp, region, service);
    hex::encode(hmac_sha256(&key, string_to_sign.as_bytes()))
}

fn canonical_query(entries: &[(String, String)]) -> String {
    let mut items: Vec<(String, String)> = entries
        .iter()
        .map(|(k, v)| {
            (
                urlencoding::encode(k).into_owned(),
                urlencoding::encode(v).into_owned(),
            )
        })
        .collect();
    items.sort();
    items
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("&")
}

#[derive(Clone)]
pub struct SigV4 {
    pub access_key: String,
    pub secret_key: String,
    pub session_token: Option<String>,
    pub region: String,
    pub service: String,
}

impl SigV4 {
    pub fn scope(&self, date: &str) -> String {
        format!("{}/{}/{}/aws4_request", date, self.region, self.service)
    }

    pub fn presign(
        &self,
        method: &str,
        host: &str,
        path: &str,
        query: &[(String, String)],
        expires_secs: u64,
        dt: &chrono::DateTime<chrono::Utc>,
    ) -> String {
        let amz_date = dt.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = dt.format("%Y%m%d").to_string();

        let mut q = query.to_vec();
        q.push(("X-Amz-Algorithm".into(), "AWS4-HMAC-SHA256".into()));
        q.push((
            "X-Amz-Credential".into(),
            format!("{}/{}", self.access_key, self.scope(&date_stamp)),
        ));
        q.push(("X-Amz-Date".into(), amz_date.clone()));
        q.push(("X-Amz-Expires".into(), expires_secs.to_string()));
        q.push(("X-Amz-SignedHeaders".into(), "host".into()));
        if let Some(t) = &self.session_token {
            q.push(("X-Amz-Security-Token".into(), t.clone()));
        }
        let sig_q = q.clone();
        let signature = signature(
            &self.secret_key,
            &self.region,
            &self.service,
            &date_stamp,
            &amz_date,
            method,
            path,
            &sig_q,
            vec![("host".into(), host.into())],
            UNSIGNED_PAYLOAD,
        );
        q.push(("X-Amz-Signature".into(), signature));
        format!("https://{}{}?{}", host, path, canonical_query(&q))
    }

    pub fn dynamodb(
        &self,
        target: &str,
        body: &[u8],
        dt: &chrono::DateTime<chrono::Utc>,
    ) -> (Vec<(String, String)>, Vec<(String, String)>) {
        let host = format!("dynamodb.{}.amazonaws.com", self.region);
        let amz_date = dt.format("%Y%m%dT%H%M%SZ").to_string();
        let date_stamp = dt.format("%Y%m%d").to_string();
        let payload_hash = sha256_hex(body);
        let mut headers = vec![
            ("host".into(), host.clone()),
            ("content-type".into(), "application/x-amz-json-1.0".into()),
            ("x-amz-content-sha256".into(), payload_hash.clone()),
            ("x-amz-date".into(), amz_date.clone()),
            ("x-amz-target".into(), format!("DynamoDB_20120810.{}", target)),
        ];
        if let Some(t) = &self.session_token {
            headers.push(("x-amz-security-token".into(), t.clone()));
        }
        let sig = signature(
            &self.secret_key,
            &self.region,
            &self.service,
            &date_stamp,
            &amz_date,
            "POST",
            "/",
            &[],
            headers.clone(),
            &payload_hash,
        );
        let mut signed = headers.clone();
        signed.sort();
        headers.push((
            "Authorization".into(),
            format!(
                "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
                self.access_key,
                self.scope(&date_stamp),
                signed
                    .iter()
                    .map(|(k, _)| k.clone())
                    .collect::<Vec<_>>()
                    .join(";"),
                sig
            ),
        ));
        (headers, vec![
            ("host".into(), host),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aws_docs_known_answer_get_vanilla() {
        let sig = signature(
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            "us-east-1",
            "s3",
            "20130524",
            "20130524T000000Z",
            "GET",
            "/test.txt",
            &[],
            vec![
                ("host".into(), "examplebucket.s3.amazonaws.com".into()),
                (
                    "x-amz-content-sha256".into(),
                    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
                ),
                ("x-amz-date".into(), "20130524T000000Z".into()),
            ],
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        assert_eq!(
            sig,
            "14f6a0997b2b70a86f4726658a6575b5109092ccb5fd328f51b369c44b4ac958"
        );
    }
}