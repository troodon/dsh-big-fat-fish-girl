//! The state the shell shares between the page bridge, the click-through loop and the
//! self-test: the current sprite cell, the page rectangles, decoded sheets and the
//! active native drag.

use std::collections::HashMap;
use std::sync::Mutex;

use bffg_shell_core::{AtlasPixels, Cell, Rect};
use tauri::{AppHandle, Manager, PhysicalPosition};

/// A pixel counts as body only above this alpha; faint anti-aliased edges pass clicks.
pub const ALPHA_THRESHOLD: u8 = 40;

/// While a drag is active: the cursor and window positions when it began, plus the
/// cursor position at the last native-drag notification tick.
#[derive(Clone, Copy)]
pub struct DragOrigin {
    pub session: u64,
    pub cursor: PhysicalPosition<f64>,
    pub window: PhysicalPosition<i32>,
    pub last_cursor: PhysicalPosition<f64>,
}

#[derive(Clone, serde::Serialize)]
pub struct NativeDragDelta {
    pub session: u64,
    pub dx: f64,
}

#[derive(Default)]
pub struct ShellState {
    pub cell: Option<Cell>,
    pub sheet: Option<String>,
    /// The skin the sheet belongs to; decoded atlases are cached per skin.
    pub skin: Option<String>,
    /// The pet rectangle in page coordinates (top-left origin), as the page reports it.
    pub pet: Option<Rect>,
    /// Visible bubble rectangles in page coordinates.
    pub bubble: Vec<Rect>,
    pub dragging: bool,
    /// Decoded sheets and where each one lives on the harness origin.
    pub sheets: HashMap<String, AtlasPixels>,
    pub sources: HashMap<String, String>,
    pub origin: String,
    /// Cancels an older startup retry when the user explicitly reconnects.
    pub connection_generation: u64,
    pub drag_origin: Option<DragOrigin>,
    /// Sub-pixel carry for `move_by`, so slow page-side dragging never loses motion.
    pub move_remainder: (f64, f64),
}

/// The small, cloneable part of the state the click-through loop needs each tick.
#[derive(Clone)]
pub struct ShellView {
    pub cell: Option<Cell>,
    pub sheet: Option<String>,
    pub skin: Option<String>,
    pub pet: Option<Rect>,
    pub bubble: Vec<Rect>,
    pub dragging: bool,
}

impl ShellState {
    pub fn view(&self) -> ShellView {
        ShellView {
            cell: self.cell,
            sheet: self.sheet.clone(),
            skin: self.skin.clone(),
            pet: self.pet,
            bubble: self.bubble.clone(),
            dragging: self.dragging,
        }
    }
}

pub fn state_of(app: &AppHandle) -> tauri::State<'_, Mutex<ShellState>> {
    app.state::<Mutex<ShellState>>()
}

pub fn parse_rect(value: &serde_json::Value) -> Option<Rect> {
    let x = value.get("x")?.as_f64()?;
    let y = value.get("y")?.as_f64()?;
    let width = value.get("width")?.as_f64()?;
    let height = value.get("height")?.as_f64()?;
    if width > 0.0 && height > 0.0 {
        Some(Rect::new(x, y, width, height))
    } else {
        None
    }
}

pub fn parse_rects(value: Option<&serde_json::Value>) -> Vec<Rect> {
    value
        .and_then(|value| value.as_array())
        .map(|list| list.iter().filter_map(parse_rect).collect())
        .unwrap_or_default()
}
