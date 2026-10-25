//! Rectangles and atlas lookups in page coordinates: CSS pixels with the origin at the top-left,
//! exactly as the page reports them. Nothing here flips an axis.

/// An axis-aligned rectangle in page coordinates, as `getBoundingClientRect()` reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    pub fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self { x, y, width, height }
    }

    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.width && y >= self.y && y <= self.y + self.height
    }
}

/// Which sheet cell a point is drawn from, for one animation frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cell {
    pub columns: u32,
    pub rows: u32,
    pub cell_width: u32,
    pub cell_height: u32,
    pub row: u32,
    pub column: u32,
    pub flip_x: bool,
}

/// Map a point inside the pet rectangle (page coordinates) to an atlas pixel. Row 0 of a cell is
/// the top of the sprite, the way the page draws it. Returns `None` when the point is outside
/// the pet or the cell is malformed.
pub fn cell_pixel(cell: &Cell, pet: Rect, x: f64, y: f64) -> Option<(u32, u32)> {
    if cell.columns == 0 || cell.rows == 0 || cell.cell_width == 0 || cell.cell_height == 0 {
        return None;
    }
    if cell.row >= cell.rows || cell.column >= cell.columns {
        return None;
    }
    if pet.width <= 0.0 || pet.height <= 0.0 || !pet.contains(x, y) {
        return None;
    }
    let u = (x - pet.x) / pet.width;
    let v = (y - pet.y) / pet.height; // page rows grow down, like the atlas
    let column = (u * cell.cell_width as f64).floor().max(0.0) as u32;
    let row = (v * cell.cell_height as f64).floor().max(0.0) as u32;
    let column = column.min(cell.cell_width - 1);
    let row = row.min(cell.cell_height - 1);
    let column = if cell.flip_x { cell.cell_width - 1 - column } else { column };
    Some((
        cell.column * cell.cell_width + column,
        cell.row * cell.cell_height + row,
    ))
}

/// Ports to probe for a running Harness, in order: the long-standing default first,
/// then a small ring around it. Pure so it can be tested without sockets.
pub fn discover_candidates(primary: u16, radius: u16) -> Vec<u16> {
    let mut ports = vec![primary];
    for offset in 1..=radius {
        let up = primary.saturating_add(offset);
        if up != primary {
            ports.push(up);
        }
        let down = primary.saturating_sub(offset);
        if down != primary && down != 0 && !ports.contains(&down) {
            ports.push(down);
        }
    }
    ports
}

/// Where the window should sit while dragged: the cursor's displacement since the
/// drag began, applied to the window position captured at that moment. Rounding once
/// from the origin (rather than per tick) keeps sub-pixel motion drift-free.
pub fn drag_target(
    origin_window: (i32, i32),
    origin_cursor: (f64, f64),
    cursor: (f64, f64),
) -> (i32, i32) {
    let dx = cursor.0 - origin_cursor.0;
    let dy = cursor.1 - origin_cursor.1;
    (
        (origin_window.0 as f64 + dx).round() as i32,
        (origin_window.1 as f64 + dy).round() as i32,
    )
}

/// Fold a fractional move into whole physical pixels, carrying the remainder into the
/// next call. Applying deltas as they come must not lose sub-pixel motion: rounding
/// each step separately makes a slow drag fall behind the cursor for good.
/// Returns the whole-pixel step and the remainder to keep.
pub fn accumulate_move(remainder: (f64, f64), dx: f64, dy: f64) -> ((i32, i32), (f64, f64)) {
    let x = remainder.0 + dx;
    let y = remainder.1 + dy;
    let step = (x.round(), y.round());
    ((step.0 as i32, step.1 as i32), (x - step.0, y - step.1))
}

/// The drag origin in cursor space: the captured cursor moved back by the distance the
/// page already travelled (logical) before the shell took over, so the grabbed point
/// stays under the cursor instead of trailing by the threshold distance.
pub fn grabbed_origin(cursor: (f64, f64), grabbed: (f64, f64), scale: f64) -> (f64, f64) {
    (cursor.0 - grabbed.0 * scale, cursor.1 - grabbed.1 * scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discover_candidates_puts_the_default_first_and_covers_the_ring() {
        let ports = discover_candidates(19387, 2);
        assert_eq!(ports[0], 19387);
        assert_eq!(&ports[1..], &[19388, 19386, 19389, 19385]);
        assert_eq!(discover_candidates(1, 2), vec![1, 2, 3], "ноль не порт");
    }

    #[test]
    fn a_rect_contains_its_edges_in_page_space() {
        let pet = Rect::new(10.0, 20.0, 100.0, 30.0);
        assert!(pet.contains(10.0, 20.0));
        assert!(pet.contains(110.0, 50.0));
        assert!(!pet.contains(10.0, 19.9));
        assert!(!pet.contains(110.1, 50.0));
    }

    fn cell() -> Cell {
        Cell { columns: 6, rows: 3, cell_width: 192, cell_height: 256, row: 1, column: 5, flip_x: false }
    }

    #[test]
    fn cell_pixel_maps_corners_and_offsets_the_cell() {
        let pet = Rect::new(0.0, 0.0, 192.0, 256.0);
        // Bottom-left of the pet (page y grows down) is the bottom-left pixel of the cell.
        assert_eq!(cell_pixel(&cell(), pet, 0.0, 255.9), Some((5 * 192, 1 * 256 + 255)));
        // Top-right is the top-right pixel.
        assert_eq!(cell_pixel(&cell(), pet, 191.9, 0.0), Some((5 * 192 + 191, 1 * 256)));
        // Outside the pet.
        assert_eq!(cell_pixel(&cell(), pet, -1.0, 10.0), None);
    }

    #[test]
    fn square_runtime_cell_hit_testing_uses_the_full_256px_canvas() {
        let square = Cell { columns: 8, rows: 11, cell_width: 256, cell_height: 256, row: 1, column: 2, flip_x: false };
        let pet = Rect::new(64.0, 0.0, 176.0, 176.0);
        assert_eq!(cell_pixel(&square, pet, 64.0, 0.0), Some((2 * 256, 1 * 256)));
        assert_eq!(cell_pixel(&square, pet, 152.0, 88.0), Some((2 * 256 + 128, 1 * 256 + 128)));
        assert_eq!(cell_pixel(&square, pet, 239.9, 175.9), Some((2 * 256 + 255, 1 * 256 + 255)));
        assert_eq!(cell_pixel(&square, pet, 240.1, 88.0), None);
        let mirrored = Cell { flip_x: true, ..square };
        assert_eq!(cell_pixel(&mirrored, pet, 64.0, 0.0), Some((2 * 256 + 255, 1 * 256)));
        assert_eq!(cell_pixel(&mirrored, pet, 239.9, 175.9), Some((2 * 256, 1 * 256 + 255)));
    }

    #[test]
    fn drag_target_follows_the_cursor_exactly() {
        let window = (100, 200);
        let start = (300.0, 400.0);
        assert_eq!(drag_target(window, start, (317.6, 342.2)), (118, 142));
        assert_eq!(drag_target(window, start, (-220.4, 90.0)), (-420, -110));
    }

    #[test]
    fn drag_target_does_not_accumulate_sub_pixel_drift() {
        let window = (100, 200);
        let start = (300.0, 400.0);
        let mut cursor = start;
        for _ in 0..1000 {
            cursor.0 += 0.3;
            drag_target(window, start, cursor);
        }
        assert_eq!(drag_target(window, start, cursor), (400, 200));
    }

    #[test]
    fn accumulate_move_keeps_sub_pixel_motion() {
        let mut remainder = (0.0, 0.0);
        let mut total = (0, 0);
        for _ in 0..1000 {
            let (step, next) = accumulate_move(remainder, 0.3, -0.2);
            remainder = next;
            total = (total.0 + step.0, total.1 + step.1);
        }
        // 1000 * 0.3 = 300 whole pixels, even though no single call reaches a pixel.
        assert_eq!(total.0, 300);
        assert_eq!(total.1, -200);
        assert!(remainder.0.abs() < 0.5 && remainder.1.abs() < 0.5);
    }

    #[test]
    fn accumulate_move_is_exact_for_whole_and_negative_steps() {
        let (step, remainder) = accumulate_move((0.0, 0.0), -4.0, 7.0);
        assert_eq!(step, (-4, 7));
        assert_eq!(remainder, (0.0, 0.0));
        let (step, remainder) = accumulate_move((0.4, -0.4), 0.2, 0.2);
        assert_eq!(step, (1, 0), "0.6 rounds up, -0.2 rounds to zero");
        assert!((remainder.0 + 0.4).abs() < 1e-9 && (remainder.1 + 0.2).abs() < 1e-9);
    }

    #[test]
    fn grabbed_origin_puts_the_press_point_under_the_cursor() {
        // The cursor moved 10x5 logical px (20x10 physical) before the takeover.
        let origin = grabbed_origin((500.0, 400.0), (10.0, 5.0), 2.0);
        assert_eq!(origin, (480.0, 390.0));
        assert_eq!(drag_target((0, 0), origin, (500.0, 400.0)), (20, 10));
    }

    #[test]
    fn cell_pixel_rejects_broken_geometry() {
        let pet = Rect::new(0.0, 0.0, 10.0, 10.0);
        assert_eq!(cell_pixel(&Cell { cell_width: 0, ..cell() }, pet, 1.0, 1.0), None);
        assert_eq!(cell_pixel(&Cell { row: 9, ..cell() }, pet, 1.0, 1.0), None);
        assert_eq!(cell_pixel(&cell(), Rect::new(0.0, 0.0, 0.0, 10.0), 0.0, 0.0), None);
    }
}
