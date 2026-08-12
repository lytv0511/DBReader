use crate::sigv4::SigV4;
use std::sync::OnceLock;

pub fn config() -> (String, SigV4) {
    static CFG: OnceLock<(String, SigV4)> = OnceLock::new();
    CFG.get_or_init(|| {
        let region = std::env::var("AWS_REGION").unwrap_or_else(|_| "ap-southeast-2".into());
        let bucket = std::env::var("SNAP_BUCKET").unwrap_or_else(|_| "dbreader-snapshots".into());
        let sig = SigV4 {
            access_key: std::env::var("AWS_ACCESS_KEY_ID").unwrap_or_default(),
            secret_key: std::env::var("AWS_SECRET_ACCESS_KEY").unwrap_or_default(),
            session_token: std::env::var("AWS_SESSION_TOKEN").ok(),
            region: region.clone(),
            service: "s3".into(),
        };
        (bucket, sig)
    })
    .clone()
}

fn host_for(bucket: &str, region: &str) -> String {
    format!("{}.s3.{}.amazonaws.com", bucket, region)
}

fn path_for(key: &str) -> String {
    format!("/{}", key)
}

pub fn upload_url(key: &str, team_id: &str) -> String {
    let (bucket, sig) = config();
    let host = host_for(&bucket, &sig.region);
    let now = chrono::Utc::now();
    let _ = team_id;
    sig.presign("PUT", &host, &path_for(key), &[], 900, &now)
}

pub fn download_url(key: &str) -> String {
    let (bucket, sig) = config();
    let host = host_for(&bucket, &sig.region);
    let now = chrono::Utc::now();
    sig.presign("GET", &host, &path_for(key), &[], 900, &now)
}

/// Permanently removes an object from the bucket. Returns Ok when the object
/// is gone (404 is treated as success). When no AWS credentials are configured
/// (offline tests), the delete is skipped and treated as success.
pub fn delete_object(key: &str) -> Result<(), String> {
    let (bucket, sig) = config();
    if sig.access_key.is_empty() {
        return Ok(());
    }
    let host = host_for(&bucket, &sig.region);
    let now = chrono::Utc::now();
    let url = sig.presign("DELETE", &host, &path_for(key), &[], 900, &now);
    match ureq::delete(&url).call() {
        Ok(_) => Ok(()),
        Err(ureq::Error::StatusCode(code)) if code == 404 => Ok(()),
        Err(e) => Err(format!("S3 delete failed: {}", e)),
    }
}