//! Decoded sheet pixels and alpha lookups — the shell's click-through data.

/// RGBA8 pixels of one decoded sheet.
pub struct AtlasPixels {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

impl AtlasPixels {
    pub fn from_rgba(width: u32, height: u32, pixels: Vec<u8>) -> Option<Self> {
        if width == 0 || height == 0 {
            return None;
        }
        if pixels.len() != (width as usize) * (height as usize) * 4 {
            return None;
        }
        Some(Self { width, height, pixels })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    /// Alpha byte at a pixel, or `None` outside the image.
    pub fn alpha_at(&self, x: u32, y: u32) -> Option<u8> {
        if x >= self.width || y >= self.height {
            return None;
        }
        let index = ((y as usize) * (self.width as usize) + (x as usize)) * 4 + 3;
        self.pixels.get(index).copied()
    }

    /// Whether the pixel counts as body (not a faint anti-aliased edge).
    pub fn is_opaque(&self, x: u32, y: u32, threshold: u8) -> bool {
        self.alpha_at(x, y).map(|alpha| alpha > threshold).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_lookup_respects_bounds() {
        let mut pixels = vec![0u8; 2 * 2 * 4];
        pixels[3] = 255; // (0,0) opaque
        pixels[(1 * 2 + 1) * 4 + 3] = 10; // (1,1) faint edge
        let atlas = AtlasPixels::from_rgba(2, 2, pixels).expect("valid");
        assert_eq!(atlas.alpha_at(0, 0), Some(255));
        assert_eq!(atlas.alpha_at(1, 1), Some(10));
        assert_eq!(atlas.alpha_at(2, 0), None);
        assert!(atlas.is_opaque(0, 0, 40));
        assert!(!atlas.is_opaque(1, 1, 40));
        assert!(!atlas.is_opaque(9, 9, 40), "вне листа — не тело");
    }

    #[test]
    fn broken_input_is_rejected_instead_of_panicking() {
        assert!(AtlasPixels::from_rgba(0, 1, vec![0, 0, 0, 0]).is_none());
        assert!(AtlasPixels::from_rgba(2, 2, vec![0, 0, 0, 0]).is_none(), "короткий буфер");
    }
}
