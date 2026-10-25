//! Where a window may walk on its screen, in the page's logical pixels.

/// The range the window's left edge may take on one monitor. `monitor_x` and the widths
/// are physical pixels as the OS reports them; the result is in logical pixels, the same
/// space the page's wanderer and the window origin share. A window wider than its monitor
/// gets a range of zero, so it simply stays put.
pub fn walk_range(monitor_x: i32, monitor_width: u32, window_width: u32, scale: f64) -> (f64, f64) {
    let min = monitor_x as f64 / scale;
    let max = (monitor_x as f64 + monitor_width as f64 - window_width as f64) / scale;
    (min, max.max(min))
}

#[cfg(test)]
mod tests {
    use super::walk_range;

    #[test]
    fn a_window_walks_from_the_left_edge_to_the_right_edge() {
        // A 1440-logical-pixel display at 2x, with a 304-logical-pixel window (608 physical).
        assert_eq!(walk_range(0, 2880, 608, 2.0), (0.0, 1136.0));
    }

    #[test]
    fn a_screen_left_of_the_main_one_has_a_negative_origin() {
        assert_eq!(walk_range(-1920, 1920, 304, 1.0), (-1920.0, -304.0));
    }

    #[test]
    fn a_window_wider_than_its_screen_stays_put() {
        assert_eq!(walk_range(0, 800, 1000, 1.0), (0.0, 0.0));
    }
}
