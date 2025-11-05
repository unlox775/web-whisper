export interface RecorderSettings {
  pauseSensitivity: number
  minPauseMs: number
  maxPauseMs: number
  windowMs: number
  overlapMs: number
  targetBitrate: number
  groqApiKey?: string
}

export interface SettingsStore {
  get(): Promise<RecorderSettings>
  set(patch: Partial<RecorderSettings>): Promise<RecorderSettings>
  subscribe(listener: (settings: RecorderSettings) => void): () => void
}

const defaultSettings: RecorderSettings = {
  pauseSensitivity: 0.5,
  minPauseMs: 400,
  maxPauseMs: 2600,
  windowMs: 30000,
  overlapMs: 800,
  targetBitrate: 64000,
}

class InMemorySettingsStore implements SettingsStore {
  #settings: RecorderSettings = { ...defaultSettings }
  #listeners = new Set<(settings: RecorderSettings) => void>()

  async get(): Promise<RecorderSettings> {
    return this.#settings
  }

  async set(patch: Partial<RecorderSettings>): Promise<RecorderSettings> {
    this.#settings = { ...this.#settings, ...patch }
    this.#listeners.forEach((listener) => listener(this.#settings))
    console.info('[SettingsStore] persisted patch', patch)
    return this.#settings
  }

  subscribe(listener: (settings: RecorderSettings) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#settings)
    return () => this.#listeners.delete(listener)
  }
}

export const settingsStore: SettingsStore = new InMemorySettingsStore()
