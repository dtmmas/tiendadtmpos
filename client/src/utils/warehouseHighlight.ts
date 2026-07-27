import type { CSSProperties } from 'react'

function hashLabel(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

export function getWarehouseHighlightStyle(label?: string | null, current = false): CSSProperties {
  const normalized = String(label || 'sin-almacen').trim().toLowerCase()
  const hue = hashLabel(normalized) % 360
  const saturation = current ? 78 : 72
  const textLightness = current ? 24 : 34

  return {
    borderColor: `hsla(${hue}, ${saturation}%, 42%, ${current ? 0.42 : 0.26})`,
    background: `hsla(${hue}, ${saturation}%, 52%, ${current ? 0.18 : 0.11})`,
    color: `hsl(${hue}, ${Math.min(88, saturation + 6)}%, ${textLightness}%)`,
    boxShadow: current ? `0 0 0 2px hsla(${hue}, ${saturation}%, 52%, 0.12)` : 'none',
  }
}
