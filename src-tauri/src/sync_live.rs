use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::sync::{self, record_last_error};
use crate::SyncGate;

const LONG_POLL_MS: u32 = 12_000;
const WAKE_TIMEOUT_SECS: u64 = 30;
const FAST_RETURN_THRESHOLD: Duration = Duration::from_millis(250);
const FAST_RETURN_LIMIT: u32 = 3;
const FALLBACK_POLL_SECS: u64 = 5;
const ERROR_BACKOFF: [Duration; 3] = [
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
];

/// Drives live sync: local writes are pushed immediately (via a SQLite
/// update hook that calls [`LiveSync::signal`]), and remote writes arrive
/// instantly through a long-polling pull thread.
pub struct LiveSync {
    dirty: Mutex<bool>,
    wake: Condvar,
    pub applying: AtomicBool,
    pub stopped: AtomicBool,
}

impl LiveSync {
    pub fn new() -> Arc<Self> {
        Arc::new(LiveSync {
            dirty: Mutex::new(false),
            wake: Condvar::new(),
            applying: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
        })
    }

    /// Wakes the push thread. Called by the SQLite update hook on any write.
    pub fn signal(&self) {
        *self.dirty.lock().unwrap() = true;
        self.wake.notify_all();
    }

    pub fn start(self: &Arc<Self>, app: AppHandle) {
        let s = Arc::clone(self);
        let a = app.clone();
        std::thread::spawn(move || s.push_thread(a));
        let s = Arc::clone(self);
        std::thread::spawn(move || s.pull_thread(app));
    }

    /// A 404 from the relay means the stored team/file mapping is stale (e.g.
    /// the cloud was cleaned up): heal by clearing the ids and reconnecting.
    fn is_missing(e: &str) -> bool {
        e.contains("404") || e.contains("Relay pull returned status 404")
    }

    fn push_thread(self: &Arc<Self>, app: AppHandle) {
        let mut backoff = 0usize;
        loop {
            if self.stopped.load(Ordering::Relaxed) {
                return;
            }
            {
                let mut dirty = self.dirty.lock().unwrap();
                if !*dirty {
                    let (guard, _res) = self
                        .wake
                        .wait_timeout(dirty, Duration::from_secs(WAKE_TIMEOUT_SECS))
                        .unwrap();
                    dirty = guard;
                }
                *dirty = false;
            }
            let gate = app.state::<SyncGate>();
            let result = (|| {
                let _guard = gate.0.lock().map_err(|_| "Sync gate poisoned".to_string())?;
                let Some((db_id, site_id, transport)) = sync::config_and_transport(&app)? else {
                    return Ok(0i64);
                };
                sync::push_pending(&app, &db_id, &site_id, transport.as_ref())
            })();
            match result {
                Ok(_) => backoff = 0,
                Err(e) => {
                    record_last_error(&app, &e);
                    if Self::is_missing(&e) && sync::heal_cloud_link(&app).is_ok() {
                        backoff = 0;
                        continue;
                    }
                    std::thread::sleep(ERROR_BACKOFF[backoff]);
                    backoff = (backoff + 1).min(ERROR_BACKOFF.len() - 1);
                }
            }
        }
    }

    fn pull_thread(self: &Arc<Self>, app: AppHandle) {
        let mut fast_returns = 0u32;
        let mut backoff = 0usize;
        loop {
            if self.stopped.load(Ordering::Relaxed) {
                return;
            }
            let gate = app.state::<SyncGate>();
            let config = sync::config_and_transport(&app);
            let (db_id, site_id, transport) = match config {
                Ok(Some(t)) => t,
                Ok(None) => {
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
                Err(e) => {
                    record_last_error(&app, &e);
                    std::thread::sleep(ERROR_BACKOFF[backoff]);
                    backoff = (backoff + 1).min(ERROR_BACKOFF.len() - 1);
                    continue;
                }
            };
            backoff = 0;

            let push_result = (|| {
                let _guard = gate.0.lock().map_err(|_| "Sync gate poisoned".to_string())?;
                sync::push_pending(&app, &db_id, &site_id, transport.as_ref())
            })();
            if let Err(e) = push_result {
                record_last_error(&app, &e);
            }

            let started = Instant::now();
            let pulled = sync::pull_remote(&app, &db_id, transport.as_ref(), LONG_POLL_MS);
            let wait_elapsed = started.elapsed();
            let pulled = match pulled {
                Ok(p) => p,
                Err(e) => {
                    record_last_error(&app, &e);
                    if Self::is_missing(&e) && sync::heal_cloud_link(&app).is_ok() {
                        backoff = 0;
                        continue;
                    }
                    std::thread::sleep(ERROR_BACKOFF[backoff]);
                    backoff = (backoff + 1).min(ERROR_BACKOFF.len() - 1);
                    continue;
                }
            };

            if pulled.ops.is_empty() {
                if wait_elapsed < FAST_RETURN_THRESHOLD {
                    fast_returns += 1;
                } else {
                    fast_returns = 0;
                }
            } else {
                fast_returns = 0;
            }

            if fast_returns >= FAST_RETURN_LIMIT {
                // The transport cannot long-poll (folder transport or an old
                // relay): fall back to periodic polling instead of hot-looping.
                fast_returns = 0;
                std::thread::sleep(Duration::from_secs(FALLBACK_POLL_SECS));
                continue;
            }

            let apply_result = (|| {
                let _guard = gate.0.lock().map_err(|_| "Sync gate poisoned".to_string())?;
                sync::apply_remote(&app, pulled)
            })();
            if let Err(e) = apply_result {
                record_last_error(&app, &e);
            }
        }
    }
}
