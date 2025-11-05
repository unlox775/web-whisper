export interface FeatureFrame {
  sessionId: string
  frameIndex: number
  rms: number
  bandRms: number
  zcr: number
  spectralCentroid: number
  spectralRolloff: number
  timestampMs: number
}

export interface SnipProposal {
  sessionId: string
  frameIndex: number
  startMs: number
  endMs: number
  confidence: number
  reason: 'pause' | 'timer' | 'forced'
}

export type AnalysisMessage =
  | { type: 'feature'; payload: FeatureFrame }
  | { type: 'proposal'; payload: SnipProposal }
  | { type: 'diagnostic'; payload: Record<string, unknown> }

export interface AnalysisWorkerConfig {
  sampleRate: number
  frameSize: number
  snipFallbackMs: number
}

export const createMockAnalysisPort = () => {
  const { port1, port2 } = new MessageChannel()
  port1.start()
  port2.start()
  return { port1, port2 }
}
