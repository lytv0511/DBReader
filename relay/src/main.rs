use std::path::PathBuf;
use std::sync::Arc;

use dbreader_relay::{serve, Relay};

fn main() {
    let mut root = PathBuf::from("sync-data");
    let mut port: u16 = 8787;
    let mut token: Option<String> = None;
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--root" => {
                i += 1;
                root = PathBuf::from(args.get(i).cloned().unwrap_or_default());
            }
            "--port" => {
                i += 1;
                port = args
                    .get(i)
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(8787);
            }
            "--token" => {
                i += 1;
                token = Some(args.get(i).cloned().unwrap_or_default());
            }
            "--help" | "-h" => {
                println!(
                    "dbreader-relay\n\nUsage: dbreader-relay [--root DIR] [--port N] [--token SECRET]\n\n  --root   data directory (default: ./sync-data)\n  --port   listen port (default: 8787)\n  --token  optional bearer token required from clients"
                );
                return;
            }
            _ => {}
        }
        i += 1;
    }
    let relay = match Relay::new(root, token) {
        Ok(r) => Arc::new(r),
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    };
    if let Err(e) = serve(relay, port) {
        eprintln!("{}", e);
        std::process::exit(1);
    }
}
