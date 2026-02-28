import { Capacitor, registerPlugin } from '@capacitor/core'

export type NativeRecorderStartOptions = {
  sessionId: string
  targetBitrate: number
  chunkDurationMs: number
}

export type NativeRecorderStartResult = {
  startedAtMs: number
  filePath: string
}

export type NativeRecorderStatusResult = {
  isRecording: boolean
  startedAtMs: number | null
  capturedMs: number
  filePath: string | null
  pendingChunks?: number
}

export type NativeRecorderStopResult = {
  capturedMs: number
}

export type NativeRecorderChunkResult = {
  sessionId: string
  seq: number
  startMs: number
  endMs: number
  bytes: number
  dataBase64: string
  format: 'pcm16le'
  sampleRate: number
}

export interface NativeIosRecorderPlugin {
  start(options: NativeRecorderStartOptions): Promise<NativeRecorderStartResult>
  status(): Promise<NativeRecorderStatusResult>
  stop(): Promise<NativeRecorderStopResult>
  consumeChunk(options: { sessionId: string }): Promise<{ chunk: NativeRecorderChunkResult | null }>
}

export const isNativeIos = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

export const isNativeIosRecorderAvailable = (): boolean => {
  if (!isNativeIos()) return false
  return Capacitor.isPluginAvailable('WWRecorder')
}

export const NativeIosRecorder = registerPlugin<NativeIosRecorderPlugin>('WWRecorder')

