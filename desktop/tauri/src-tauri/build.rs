fn main() {
    // Declaring the app commands puts them into the ACL, which is what lets a capability
    // grant them to a remote (loopback) page; without this, Tauri answers
    // "move_by not allowed. Plugin not found" for remote origins.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "move_by",
                "quit_app",
                "start_drag",
                "end_drag",
                "reset_position",
                "frame",
                "interactive_regions",
                "open_target",
                "open_menu",
                "ping",
                "self_report",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
