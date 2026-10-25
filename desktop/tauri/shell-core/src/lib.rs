//! Pure shell math: no GUI, no Tauri, no I/O — the parts that can be tested headlessly.
//!
//! Every coordinate here is in page space: CSS pixels with the origin at the top-left, the way
//! the page reports its rectangles. The platform code converts the native window's coordinates
//! once, where it reads them, so no hit-test or sprite lookup has to flip an axis.

pub mod atlas;
pub mod geometry;
pub mod walk;

pub use atlas::AtlasPixels;
pub use geometry::{
    accumulate_move, cell_pixel, discover_candidates, drag_target, grabbed_origin, Cell, Rect,
};
