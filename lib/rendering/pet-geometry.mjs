// Screen geometry for the square runtime cells. The preference still means the old
// 192px frame width, so widening the cell keeps the character's pixel scale unchanged.
export const REFERENCE_CELL_WIDTH = 192
export const RUNTIME_CELL_SIZE = 256

export function canvasSideForSize(size, cellSize = RUNTIME_CELL_SIZE, referenceWidth = REFERENCE_CELL_WIDTH) {
  return Number(size) * cellSize / referenceWidth
}

export function centeredCanvasOffset(size, cellSize = RUNTIME_CELL_SIZE, referenceWidth = REFERENCE_CELL_WIDTH) {
  return -(canvasSideForSize(size, cellSize, referenceWidth) - Number(size)) / 2
}

/** Map a point from a square canvas rectangle to its RGBA cell pixel. */
export function canvasPixelAt(rect, x, y, cellSize = RUNTIME_CELL_SIZE) {
  if (rect === null || rect === undefined || rect.width <= 0 || rect.height <= 0
    || x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) return null
  return {
    x: Math.min(cellSize - 1, Math.floor((x - rect.x) / rect.width * cellSize)),
    y: Math.min(cellSize - 1, Math.floor((y - rect.y) / rect.height * cellSize)),
  }
}
