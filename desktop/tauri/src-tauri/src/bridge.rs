//! The page's bridge adapter: the desktop page speaks `window.__BFFG_SHELL__`, Tauri
//! has its own IPC. This is the only place that maps one onto the other.

pub const BRIDGE: &str = r#"
window.__BFFG_SHELL__ = {
  moveBy(dx, dy) { window.__TAURI__.core.invoke('move_by', { dx: dx, dy: dy }) },
  menu(x, y, labels) { window.__TAURI__.core.invoke('open_menu', { labels: labels || null }) },
  quit() { window.__TAURI__.core.invoke('quit_app') },
  frame(f) { window.__TAURI__.core.invoke('frame', f) },
  interactiveRegions(r) { window.__TAURI__.core.invoke('interactive_regions', r) },
  openTarget(t) { window.__TAURI__.core.invoke('open_target', t) },
  onDragMove(listener) {
    return window.__TAURI__.event.listen('native-drag-move', event => listener(event.payload));
  },
  startDrag(session, grabbedX, grabbedY) {
    return window.__TAURI__.core.invoke('start_drag', { session, grabbedX, grabbedY });
  },
  endDrag(session) { return window.__TAURI__.core.invoke('end_drag', { session }); },
};
"#;
