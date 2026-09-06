use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, plugin::PluginHandle};

const PLUGIN_IDENTIFIER: &str = "com.vincentleong.dbreader";
const PLUGIN_CLASS: &str = "FileBridgePlugin";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_filebridge);


struct FileBridgeState(Mutex<Option<PluginHandle<tauri::Wry>>>);

impl Default for FileBridgeState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Serialize)]
struct CopyArgs<'a> {
    uri: &'a str,
    file_name: &'a str,
}

#[derive(Deserialize)]
struct CopyResponse {
    path: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct PrintArgs {
    html: String,
    title: String,
}

#[tauri::command]
async fn print_html(
    html: String,
    title: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let state = app.state::<FileBridgeState>();
        let handle = state
            .0
            .lock()
            .unwrap()
            .clone()
            .ok_or("file-bridge plugin not started")?;
        drop(state);
        handle
            .run_mobile_plugin_async::<serde_json::Value>(
                "printHtml",
                PrintArgs {
                    html: html.clone(),
                    title: title.clone(),
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = (html, title, app);
        Err("Printing is only supported on mobile".into())
    }
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("filebridge")
        .invoke_handler(tauri::generate_handler![
            copy_uri_to_cache,
            export_to_document,
            print_html
        ])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, PLUGIN_CLASS)?;
                app.manage(FileBridgeState(Mutex::new(Some(handle))));
            }
            #[cfg(target_os = "ios")]
            {
                let handle = api.register_ios_plugin(init_plugin_filebridge)?;
                app.manage(FileBridgeState(Mutex::new(Some(handle))));
            }
            Ok(())
        })
        .build()
}

#[tauri::command]
async fn copy_uri_to_cache(
    uri: String,
    file_name: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let state = app.state::<FileBridgeState>();
        let handle = state
            .0
            .lock()
            .unwrap()
            .clone()
            .ok_or("file-bridge plugin not started")?;
        drop(state);
        let response: CopyResponse = handle
            .run_mobile_plugin_async(
                "copyToCache",
                CopyArgs {
                    uri: &uri,
                    file_name: &file_name,
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        response.path.ok_or_else(|| "Copy failed, no path returned".into())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = (uri, file_name, app);
        Err("File import is only supported on mobile".into())
    }
}

#[tauri::command]
async fn export_to_document(
    path: String,
    file_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let state = app.state::<FileBridgeState>();
        let handle = state
            .0
            .lock()
            .unwrap()
            .clone()
            .ok_or("file-bridge plugin not started")?;
        drop(state);
        handle
            .run_mobile_plugin_async::<serde_json::Value>(
                "exportDocument",
                CopyArgs {
                    uri: &path,
                    file_name: &file_name,
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = (path, file_name, app);
        Err("File export is only supported on mobile".into())
    }
}
