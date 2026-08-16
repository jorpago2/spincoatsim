import type {
  ExpansionLimits,
  GdsImportResult,
  GdsProgress,
  GdsWorkerRequestPayload,
  GdsWorkerResponse,
} from './gdsProtocol'

export type {
  ExpansionLimits,
  GdsCompleteResult,
  GdsImportResult,
  GdsProgress,
  GdsSelectionResult,
  GdsShape,
} from './gdsProtocol'

type PendingRequest = {
  resolve: (value: GdsImportResult) => void
  reject: (reason: unknown) => void
  onProgress?: (progress: GdsProgress) => void
}

let worker: Worker | null = null
let generation = 0
const pending = new Map<string, PendingRequest>()

function activeWorker() {
  if (worker) return worker
  const currentGeneration = generation
  worker = new Worker(new URL('./gds.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.addEventListener('message', (event: MessageEvent<GdsWorkerResponse>) => {
    if (currentGeneration !== generation) return
    const message = event.data
    const request = pending.get(message.requestId)
    if (!request) return
    if (message.type === 'progress') {
      request.onProgress?.({
        stage: message.stage,
        completed: message.completed,
      })
      return
    }
    pending.delete(message.requestId)
    if (message.type === 'error') {
      request.reject(new Error(message.message))
      return
    }
    if (message.type === 'selection-required') {
      request.resolve({
        kind: message.type,
        importId: message.importId,
        topCells: message.topCells,
        compatibilityWarnings: message.compatibilityWarnings,
      })
      return
    }
    request.resolve({
      kind: message.type,
      importId: message.importId,
      topCell: message.topCell,
      shapes: message.shapes,
      bounds: message.bounds,
      compatibilityWarnings: message.compatibilityWarnings,
    })
  })
  worker.addEventListener('error', (event) => {
    if (currentGeneration !== generation) return
    const error = new Error(event.message || 'The GDS worker stopped unexpectedly.')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    worker?.terminate()
    worker = null
  })
  return worker
}

function requestGds(
  message: GdsWorkerRequestPayload,
  transfer: Transferable[],
  onProgress?: (progress: GdsProgress) => void,
) {
  const requestId = crypto.randomUUID()
  return new Promise<GdsImportResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject, onProgress })
    try {
      activeWorker().postMessage({ ...message, requestId }, transfer)
    } catch (error) {
      pending.delete(requestId)
      reject(error)
    }
  })
}

export function importGdsFile(
  buffer: ArrayBuffer,
  limits: ExpansionLimits,
  onProgress?: (progress: GdsProgress) => void,
) {
  return requestGds({ type: 'parse', buffer, limits }, [buffer], onProgress)
}

export function flattenPendingGds(
  importId: string,
  topCell: string,
  limits: ExpansionLimits,
  onProgress?: (progress: GdsProgress) => void,
) {
  return requestGds(
    { type: 'flatten', importId, topCell, limits },
    [],
    onProgress,
  )
}

export function cancelGdsImport() {
  generation += 1
  worker?.terminate()
  worker = null
  const error = new DOMException('GDS import cancelled.', 'AbortError')
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}
