import { useEffect, useState, type RefObject } from 'react'
import { useScientificPlotTheme } from '@jorpago2/scientific-ui'
import type { SectionResult } from '../spincoatTypes'

const RESOLUTION = 480

function plotMargins(width: number) {
  return width < 600
    ? { left: 52, right: 14, top: 34, bottom: 43 }
    : { left: 76, right: 30, top: 38, bottom: 55 }
}

type SpinCoatCanvasProps = {
  canvasRef: RefObject<HTMLCanvasElement | null>
  section: SectionResult
  cursorIndex: number
  setCursorIndex: (index: number | ((current: number) => number)) => void
  cursorX: number
  localThickness: number
  sliceY: number
  viewWidth: number
  xMin: number
}

export function SpinCoatCanvas({
  canvasRef,
  section,
  cursorIndex,
  setCursorIndex,
  cursorX,
  localThickness,
  sliceY,
  viewWidth,
  xMin,
}: SpinCoatCanvasProps) {
  const plotTheme = useScientificPlotTheme()
  const [canvasCssWidth, setCanvasCssWidth] = useState(1200)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setCanvasCssWidth(Math.max(1, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [canvasRef])

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const width = canvasCssWidth
    const height = Math.round(width * 650 / 1200)
    const pixelRatio = window.devicePixelRatio || 1
    element.width = Math.round(width * pixelRatio)
    element.height = Math.round(height * pixelRatio)
    const context = element.getContext('2d')
    if (!context) return
    const styles = getComputedStyle(document.documentElement)
    const color = (token: string) => styles.getPropertyValue(token).trim()
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.fillStyle = color('--color-plot-background')
    context.fillRect(0, 0, width, height)

    const compact = width < 600
    const plotFontSize = compact ? 11 : 12
    const margin = plotMargins(width)
    const plotWidth = width - margin.left - margin.right
    const plotHeight = height - margin.top - margin.bottom
    const minZ = Math.min(...section.columns.flatMap((column) => column.map((segment) => segment.bottom)))
    const highestFilmPoint = Math.max(...section.film.top)
    const maxZ = highestFilmPoint + Math.max(20, (highestFilmPoint - minZ) * 0.05)
    const zRange = maxZ - minZ
    const mapY = (z: number) => margin.top + ((maxZ - z) / zRange) * plotHeight
    const columnWidth = plotWidth / RESOLUTION
    const verticalExaggeration = (viewWidth * 1000 / plotWidth) / (zRange / plotHeight)

    context.strokeStyle = color('--color-plot-grid')
    context.lineWidth = 1
    context.font = `${plotFontSize}px ${styles.getPropertyValue('--font-mono').trim()}`
    context.fillStyle = color('--color-plot-axis')
    const verticalTicks = compact ? 3 : 5
    for (let tick = 0; tick <= verticalTicks; tick += 1) {
      const y = margin.top + (tick / verticalTicks) * plotHeight
      const z = maxZ - (tick / verticalTicks) * zRange
      context.beginPath()
      context.moveTo(margin.left, y)
      context.lineTo(width - margin.right, y)
      context.stroke()
      context.fillText(`${Math.round(z)}`, 8, y + 4)
    }

    section.columns.forEach((column, index) => {
      const x = margin.left + index * columnWidth
      for (const segment of column) {
        context.fillStyle = segment.color
        context.fillRect(x, mapY(segment.top), Math.ceil(columnWidth + 0.5), Math.max(1, mapY(segment.bottom) - mapY(segment.top)))
      }
      context.fillStyle = color('--color-plot-film')
      context.fillRect(x, mapY(section.film.top[index]), Math.ceil(columnWidth + 0.5), Math.max(1, mapY(section.film.surface[index]) - mapY(section.film.top[index])))
    })

    const strokeProfile = (values: number[], stroke: string, lineWidth: number) => {
      context.strokeStyle = stroke
      context.lineWidth = lineWidth
      context.beginPath()
      values.forEach((z, index) => {
        const x = margin.left + (index + 0.5) * columnWidth
        if (index === 0) context.moveTo(x, mapY(z))
        else context.lineTo(x, mapY(z))
      })
      context.stroke()
    }
    strokeProfile(section.film.surface, color('--color-plot-surface'), 1)
    strokeProfile(section.film.top, color('--color-plot-film'), 2)

    const cursorCanvasX = margin.left + (cursorIndex + 0.5) * columnWidth
    const cursorSurfaceY = mapY(section.film.surface[cursorIndex])
    const cursorTopY = mapY(section.film.top[cursorIndex])
    context.strokeStyle = color('--color-plot-cursor')
    context.setLineDash([6, 5])
    context.beginPath()
    context.moveTo(cursorCanvasX, margin.top)
    context.lineTo(cursorCanvasX, height - margin.bottom)
    context.stroke()
    context.setLineDash([])
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(cursorCanvasX, cursorTopY)
    context.lineTo(cursorCanvasX, cursorSurfaceY)
    context.stroke()
    context.fillStyle = color('--color-plot-cursor')
    for (const y of [cursorTopY, cursorSurfaceY]) {
      context.beginPath()
      context.arc(cursorCanvasX, y, compact ? 2 : 3, 0, 2 * Math.PI)
      context.fill()
    }
    const labelWidth = compact ? 76 : 88
    const labelHeight = compact ? 18 : 20
    const labelX = cursorCanvasX + labelWidth + 10 > width - margin.right ? cursorCanvasX - labelWidth - 8 : cursorCanvasX + 8
    const labelY = Math.max(margin.top + 5, cursorTopY - 23)
    context.fillStyle = color('--color-plot-tooltip')
    context.fillRect(labelX, labelY, labelWidth, labelHeight)
    context.fillStyle = color('--color-plot-tooltip-ink')
    context.fillText(`${section.film.localThickness[cursorIndex].toFixed(1)} nm`, labelX + 5, labelY + (compact ? 13 : 14))

    context.fillStyle = color('--color-plot-axis')
    context.textAlign = 'center'
    const horizontalTicks = compact ? 2 : 4
    for (let tick = 0; tick <= horizontalTicks; tick += 1) {
      const x = margin.left + (tick / horizontalTicks) * plotWidth
      context.fillText(`${(xMin + (tick / horizontalTicks) * viewWidth).toFixed(1)}`, x, height - (compact ? 15 : 23))
    }
    context.textAlign = 'left'
    context.fillText('z (nm)', 8, margin.top - 10)
    context.textAlign = 'right'
    context.fillText('x (µm)', width - margin.right, height - 4)
    context.textAlign = 'left'
    context.fillStyle = color('--color-plot-cursor')
    context.fillText(compact
      ? `y = ${sliceY.toFixed(2)} µm · z ×${verticalExaggeration.toFixed(0)}`
      : `Section y = ${sliceY.toFixed(2)} µm · vertical exaggeration ×${verticalExaggeration.toFixed(0)}`,
    margin.left, 20)
  }, [canvasCssWidth, canvasRef, cursorIndex, plotTheme, section, sliceY, viewWidth, xMin])

  const sampleIndices = [...new Set([
    0,
    Math.round((RESOLUTION - 1) * 0.25),
    Math.round((RESOLUTION - 1) * 0.5),
    Math.round((RESOLUTION - 1) * 0.75),
    RESOLUTION - 1,
    cursorIndex,
  ])].sort((a, b) => a - b)
  const surfaceRange = `${Math.min(...section.film.surface).toFixed(1)}–${Math.max(...section.film.surface).toFixed(1)} nm`
  const filmRange = `${section.film.minimumThicknessNm.toFixed(1)}–${section.film.maximumThicknessNm.toFixed(1)} nm`

  return <>
    <canvas
      ref={canvasRef}
      width={1200}
      height={650}
      className="spin-canvas scientific-render-surface--dark"
      aria-label="Spin-coated cross-section plot: substrate surface and film top in nanometres versus x position in micrometres"
      aria-describedby="spin-readout spin-profile-description"
      tabIndex={0}
      onPointerMove={(event) => {
        const element = event.currentTarget
        const width = Math.max(1, element.clientWidth)
        const margin = plotMargins(width)
        const plotWidth = Math.max(1, width - margin.left - margin.right)
        const rectangle = element.getBoundingClientRect()
        const x = event.clientX - rectangle.left - element.clientLeft
        setCursorIndex(Math.max(0, Math.min(RESOLUTION - 1, Math.floor(((x - margin.left) / plotWidth) * RESOLUTION))))
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        setCursorIndex((index) => Math.max(0, Math.min(RESOLUTION - 1, index + (event.key === 'ArrowLeft' ? -step : step))))
      }}
    />
    <div className="spin-readout" id="spin-readout"><span>x = {cursorX.toFixed(2)} µm</span><strong>{localThickness.toFixed(1)} nm local coating</strong></div>
    <p id="spin-profile-description" className="spin-accessible-description">
      Section y = {sliceY.toFixed(2)} µm. The imported geometry crosses {section.geometry.intervalCount} positive-width interval{section.geometry.intervalCount === 1 ? "" : "s"} covering {section.geometry.coveredWidthMicrometers.toFixed(2)} µm. Surface range {surfaceRange}; local film thickness range {filmRange}. Use the accessible profile table for representative numeric samples; export JSON for the full {RESOLUTION}-sample dataset.
    </p>
    <details className="spin-accessible-data">
      <summary>Accessible profile data</summary>
      <table aria-label="Accessible spin-coated profile data">
        <caption>Representative cross-section samples for the current section</caption>
        <thead><tr><th scope="col">x (µm)</th><th scope="col">Surface (nm)</th><th scope="col">Film top (nm)</th><th scope="col">Local film (nm)</th></tr></thead>
        <tbody>{sampleIndices.map((index) => <tr key={index}>
          <td>{(xMin + ((index + 0.5) / RESOLUTION) * viewWidth).toFixed(2)}</td>
          <td>{section.film.surface[index].toFixed(2)}</td>
          <td>{section.film.top[index].toFixed(2)}</td>
          <td>{section.film.localThickness[index].toFixed(2)}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </>
}
