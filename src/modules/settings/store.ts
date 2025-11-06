export interface RecorderSettings {
  pauseSensitivity: number
  minPauseMs: number
  maxPauseMs: number
  windowMs: number
  overlapMs: number
  targetBitrate: number
  groqApiKey?: string
  developerMode: boolean
  storageLimitBytes: number
}

export interface SettingsStore {
  get(): Promise<RecorderSettings>
  set(patch: Partial<RecorderSettings>): Promise<RecorderSettings>
  subscribe(listener: (settings: RecorderSettings) => void): () => void
}

const MB = 1024 * 1024
const defaultSettings: RecorderSettings = {
  pauseSensitivity: 0.5,
  minPauseMs: 400,
  maxPauseMs: 2600,
  windowMs: 30000,
  overlapMs: 800,
  targetBitrate: 64000,
  groqApiKey: '',
  developerMode: false,
  storageLimitBytes: 200 * MB,
}

const STORAGE_KEY = 'durable-recorder-settings'

function loadFromStorage(): RecorderSettings | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<RecorderSettings>
    if (!parsed) return null
    return { ...defaultSettings, ...parsed }
  } catch (error) {
    console.warn('[SettingsStore] Failed to parse settings', error)
    return null
  }
}

function persistToStorage(settings: RecorderSettings) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

class PersistentSettingsStore implements SettingsStore {
  #settings: RecorderSettings
  #listeners = new Set<(settings: RecorderSettings) => void>()

  constructor() {
    this.#settings = loadFromStorage() ?? { ...defaultSettings }
  }

  async get(): Promise<RecorderSettings> {
    return this.#settings
  }

  async set(patch: Partial<RecorderSettings>): Promise<RecorderSettings> {
    this.#settings = { ...this.#settings, ...patch }
    persistToStorage(this.#settings)
    this.#listeners.forEach((listener) => listener(this.#settings))
    return this.#settings
  }

  subscribe(listener: (settings: RecorderSettings) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#settings)
    return () => this.#listeners.delete(listener)
  }
}

export const settingsStore: SettingsStore = new PersistentSettingsStore()
