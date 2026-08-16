import type { flattenGds } from '../../lib/gds.js'

export type GdsShape = ReturnType<typeof flattenGds>[number]

export type ExpansionLimits = {
  maxShapes: number
  maxInstances: number
  maxPoints: number
}

export type GdsProgress = { stage: string; completed: number }

export type GdsWorkerRequest =
  | {
      type: 'parse'
      requestId: string
      buffer: ArrayBuffer
      limits: ExpansionLimits
    }
  | {
      type: 'flatten'
      requestId: string
      importId: string
      topCell: string
      limits: ExpansionLimits
    }

export type GdsWorkerRequestPayload = GdsWorkerRequest extends infer Request
  ? Request extends { requestId: string }
    ? Omit<Request, 'requestId'>
    : never
  : never

export type GdsWorkerResponse =
  | ({ type: 'progress'; requestId: string } & GdsProgress)
  | {
      type: 'selection-required'
      requestId: string
      importId: string
      topCells: string[]
      compatibilityWarnings: string[]
    }
  | {
      type: 'complete'
      requestId: string
      importId: string
      topCell: string
      shapes: GdsShape[]
      bounds: {
        minX: number
        maxX: number
        minY: number
        maxY: number
        width: number
        height: number
      }
      compatibilityWarnings: string[]
    }
  | { type: 'error'; requestId: string; message: string }

export type GdsSelectionResult = Omit<
  Extract<GdsWorkerResponse, { type: 'selection-required' }>,
  'type' | 'requestId'
> & { kind: 'selection-required' }

export type GdsCompleteResult = Omit<
  Extract<GdsWorkerResponse, { type: 'complete' }>,
  'type' | 'requestId'
> & { kind: 'complete' }

export type GdsImportResult = GdsSelectionResult | GdsCompleteResult
