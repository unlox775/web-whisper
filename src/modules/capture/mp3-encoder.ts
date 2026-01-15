let mp3LoadPromise: Promise<void> | null = null

// Load the bundled browser build of lamejs as a classic script so it defines `window.lamejs`.
import lameAllUrl from 'lamejs/lame.all.js?url'

type LameGlobal = {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array
    flush(): Int8Array
  }
}

export async function ensureMp3EncoderLoaded(): Promise<void> {
  if (typeof window === 'undefined') {
    throw new Error('MP3 encoder can only load in a browser.')
  }
  if ((window as any).lamejs?.Mp3Encoder) {
    return
  }
  if (mp3LoadPromise) {
    return mp3LoadPromise
  }
  mp3LoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = lameAllUrl
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load MP3 encoder script.'))
    document.head.appendChild(script)
  }).then(() => {
    if (!((window as any).lamejs?.Mp3Encoder)) {
      throw new Error('MP3 encoder loaded but window.lamejs.Mp3Encoder is missing.')
    }
  })
  return mp3LoadPromise
}

export function getMp3EncoderCtor(): LameGlobal['Mp3Encoder'] {
  const ctor = (window as any).lamejs?.Mp3Encoder as LameGlobal['Mp3Encoder'] | undefined
  if (!ctor) {
    throw new Error('MP3 encoder is not loaded yet.')
  }
  return ctor
}

