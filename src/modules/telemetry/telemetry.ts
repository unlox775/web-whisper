export interface TelemetryEvent {
  type:
    | 'chunk-enqueued'
    | 'chunk-uploaded'
    | 'chunk-failed'
    | 'vad-diagnostic'
    | 'transcription-queued'
    | 'transcription-failed'
    | 'storage-warning'
  payload: Record<string, unknown>
  timestamp: number
}

export interface TelemetrySink {
  record(event: TelemetryEvent): void
  flush(): Promise<void>
}

class ConsoleTelemetrySink implements TelemetrySink {
  record(event: TelemetryEvent): void {
    console.debug('[Telemetry]', event.type, event.payload)
  }

  async flush(): Promise<void> {
    console.debug('[Telemetry] flush noop')
  }
}

export const telemetrySink: TelemetrySink = new ConsoleTelemetrySink()
