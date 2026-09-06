const COMMANDS: &[&str] = &["copy_uri_to_cache", "export_to_document", "print_html"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}