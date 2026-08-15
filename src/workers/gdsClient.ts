import type { flattenGds } from '../../lib/gds.js'

export type GdsShape = ReturnType<typeof flattenGds>[number]
export type ExpansionLimits = {
  maxShapes: number
  maxInstances: number
  maxPoints: number
}
export type GdsProgress = { stage: string; completed: number }
export type GdsSelectionResult = {
  kind: 'selection-required'
  importId: string
  topCells: string[]
  compatibilityWarnings: string[]
}
export type GdsCompleteResult = {
  kind: 'complete'
  importId: string
  topCell: string
  shapes: GdsShape[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number }
  compatibilityWarnings: string[]
}
export type GdsImportResult = GdsSelectionResult | GdsCompleteResult

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
  worker.addEventListener('message', (event) => {
    if (currentGeneration !== generation) return
    const message = event.data as {
      type: 'progress' | 'selection-required' | 'complete' | 'error'
      requestId: string
      stage?: string
      completed?: number
      message?: string
    } & Record<string, unknown>
    const request = pending.get(message.requestId)
    if (!request) return
    if (message.type === 'progress') {
      request.onProgress?.({
        stage: message.stage ?? 'Processing GDS',
        completed: message.completed ?? 0,
      })
      return
    }
    pending.delete(message.requestId)
    if (message.type === 'error') {
      request.reject(new Error(message.message ?? 'The GDS import failed.'))
      return
    }
    request.resolve({
      ...message,
      kind: message.type,
    } as unknown as GdsImportResult)
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
  message: Record<string, unknown>,
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
