import { Capacitor, registerPlugin } from '@capacitor/core'

export type NativeRecorderStartOptions = {
  sessionId: string
  targetBitrate: number
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
}

export type NativeRecorderStopResult = {
  filePath: string
  capturedMs: number
  bytes: number
}

export interface NativeIosRecorderPlugin {
  start(options: NativeRecorderStartOptions): Promise<NativeRecorderStartResult>
  status(): Promise<NativeRecorderStatusResult>
  stop(): Promise<NativeRecorderStopResult>
}

export const isNativeIos = (): boolean => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios'

export const isNativeIosRecorderAvailable = (): boolean => {
  if (!isNativeIos()) return false
  const plugins = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins
  if (!plugins) return false
  return typeof plugins.WWRecorder !== 'undefined'
}

export const NativeIosRecorder = registerPlugin<NativeIosRecorderPlugin>('WWRecorder')

