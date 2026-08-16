import type { GdsShape } from './workers/gdsClient'

export type LayerMode = 'uniform' | 'patterned' | 'etch'
export type StackLayer = { id: number; name: string; mode: LayerMode; thicknessNm: number; gdsLayer: number; color: string }
export type MaterialSegment = { name: string; color: string; bottom: number; top: number }
export type ToolPanel = 'input' | 'stack' | 'coating'
export type Provenance = 'Reference' | 'Edited' | 'Model default' | 'Custom'
export type CalibrationState = {
  referenceThickness: number
  referenceRpm: number
  rpm: number
  exponent: number
  shrinkage: number
}
export type CalibrationField = keyof CalibrationState
export type CoatingReference = {
  id: string
  label: string
  name: string
  detail: string
  referenceThicknessNm: number
  referenceRpm: number
  sourceUrl: string
}
export type ExportNotice = { fileName: string; context: string }
export type PendingGds = { importId: string; topCells: string[]; compatibilityWarnings: string[]; fileName: string; sha256: string; selectedCell: string }
export type SpinSession = {
  shapes?: GdsShape[]
  fileName: string
  topCell: string
  sourceSha256: string
  compatibilityWarnings: string[]
  sliceY: number
  centreX: number
  viewWidth: number
  substrateThickness: number
  layers: StackLayer[]
  calibration: CalibrationState
  coatingLibrary: 'photoresist' | 'oxide'
  coatingPresetId: string
  photoresistPolarity: string
  photoresistManufacturer: string
  photoresistExposureNm: string
  metalOxideFamily: string
  levelingStrength: number
  levelingLength: number
}
export type SectionResult = {
  columns: MaterialSegment[][]
  film: {
    surface: number[]
    top: number[]
    localThickness: number[]
    minimumThicknessNm: number
    maximumThicknessNm: number
    meanThicknessNm: number
    degreeOfPlanarizationPercent: number
    thicknessNonUniformityPercent: number
  }
  ignoredPaths: number
}
