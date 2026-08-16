import {
  boundsOf,
  flattenGds,
  parseGds,
} from '../../lib/gds.js'
import type {
  ExpansionLimits,
  GdsWorkerRequest,
  GdsWorkerResponse,
} from './gdsProtocol'

const parsedImports = new Map<string, ReturnType<typeof parseGds>>()

function respond(message: GdsWorkerResponse) {
  self.postMessage(message)
}

function progress(requestId: string, stage: string, completed: number) {
  respond({ type: 'progress', requestId, stage, completed })
}

function flattenImport(
  requestId: string,
  importId: string,
  model: ReturnType<typeof parseGds>,
  topCell: string,
  limits: ExpansionLimits,
) {
  try {
    progress(requestId, 'Flattening hierarchy', 0.65)
    const shapes = flattenGds(model, topCell, limits)
    const bounds = boundsOf(shapes)
    progress(requestId, 'Preparing section', 0.95)
    respond({
      type: 'complete',
      requestId,
      importId,
      topCell,
      shapes,
      bounds,
      compatibilityWarnings: model.compatibility.warnings,
    })
  } finally {
    parsedImports.delete(importId)
  }
}

self.addEventListener('message', (event: MessageEvent<GdsWorkerRequest>) => {
  const request = event.data
  try {
    if (request.type === 'parse') {
      progress(request.requestId, 'Reading GDS records', 0.1)
      const model = parseGds(request.buffer)
      const importId = request.requestId
      parsedImports.set(importId, model)
      progress(request.requestId, 'Inspecting top cells', 0.5)
      if (model.topCells.length > 1) {
        respond({
          type: 'selection-required',
          requestId: request.requestId,
          importId,
          topCells: model.topCells,
          compatibilityWarnings: model.compatibility.warnings,
        })
        return
      }
      flattenImport(
        request.requestId,
        importId,
        model,
        model.topCells[0]!,
        request.limits,
      )
      return
    }

    const model = parsedImports.get(request.importId)
    if (!model) {
      throw new Error('The pending GDS import expired; select the file again.')
    }
    if (!model.topCells.includes(request.topCell)) {
      throw new Error('The selected top cell is not present in the GDS file.')
    }
    flattenImport(
      request.requestId,
      request.importId,
      model,
      request.topCell,
      request.limits,
    )
  } catch (error) {
    respond({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'The GDS import failed.',
    })
  }
})
