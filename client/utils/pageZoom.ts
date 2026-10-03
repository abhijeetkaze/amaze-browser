// Page zoom levels, the same steps Chrome uses
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]

export const MIN_ZOOM = ZOOM_LEVELS[0]
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]

export function nextZoomLevel(zoom: number) {
  return ZOOM_LEVELS.find(level => level > zoom + 0.001) ?? MAX_ZOOM
}

export function previousZoomLevel(zoom: number) {
  return [...ZOOM_LEVELS].reverse().find(level => level < zoom - 0.001) ?? MIN_ZOOM
}
