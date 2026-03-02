import Foundation
import AVFoundation
import Capacitor

@objc(WWRecorder)
public class WWRecorder: CAPPlugin {
    private var audioEngine: AVAudioEngine?
    private var startedAtMs: Int64?
    private var sessionId: String?
    private var chunkDurationMs: Int64 = 4000
    private var chunkSeq: Int = 0
    private var sampleRate: Double = 44100
    private var framesPerChunk: Int = 0
    private var totalFramesCaptured: Int64 = 0
    private var currentChunkFrames: Int = 0
    private var currentChunkStartMs: Int64?
    private var currentChunkFileHandle: FileHandle?
    private var currentChunkPath: String?
    private var pending: [[String: Any]] = []

    private func recordingsDirUrl() -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documents.appendingPathComponent("WebWhisperRecordings", isDirectory: true)
    }

    private func chunkFileUrl(sessionId: String, seq: Int) -> URL {
        let filename = String(format: "%@-chunk-%05d.pcm", sessionId, seq)
        return recordingsDirUrl().appendingPathComponent(filename, isDirectory: false)
    }

    private func nowMs() -> Int64 {
        return Int64(Date().timeIntervalSince1970 * 1000.0)
    }

    private func startNewChunkFile(sessionId: String) throws {
        let dir = recordingsDirUrl()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let fileUrl = chunkFileUrl(sessionId: sessionId, seq: chunkSeq)
        if FileManager.default.fileExists(atPath: fileUrl.path) {
            try FileManager.default.removeItem(at: fileUrl)
        }
        FileManager.default.createFile(atPath: fileUrl.path, contents: nil)
        let handle = try FileHandle(forWritingTo: fileUrl)
        self.currentChunkFileHandle = handle
        self.currentChunkPath = "WebWhisperRecordings/\(fileUrl.lastPathComponent)"
        self.currentChunkFrames = 0
        self.currentChunkStartMs = startedAtMs.map { $0 + Int64(Double(totalFramesCaptured) / sampleRate * 1000.0) }
    }

    private func finalizeChunkIfNeeded(force: Bool) {
        guard let sessionId = sessionId, let startMs = currentChunkStartMs, let filePath = currentChunkPath else {
            return
        }
        if !force && currentChunkFrames < framesPerChunk {
            return
        }
        do {
            try currentChunkFileHandle?.close()
        } catch {
            // best-effort
        }
        currentChunkFileHandle = nil

        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let fileUrl = documents.appendingPathComponent(filePath, isDirectory: false)
        let attrs = try? FileManager.default.attributesOfItem(atPath: fileUrl.path)
        let bytes = (attrs?[FileAttributeKey.size] as? NSNumber)?.intValue ?? 0

        let endMs = startedAtMs.map { $0 + Int64(Double(totalFramesCaptured) / sampleRate * 1000.0) } ?? (startMs)
        if bytes > 0 && endMs > startMs {
            pending.append([
                "sessionId": sessionId,
                "seq": chunkSeq,
                "startMs": startMs,
                "endMs": endMs,
                "bytes": bytes,
                "filePath": filePath,
                "format": "pcm16le",
                "sampleRate": Int(sampleRate),
            ])
        }

        chunkSeq += 1
        currentChunkStartMs = nil
        currentChunkPath = nil
    }

    @objc func start(_ call: CAPPluginCall) {
        if let engine = audioEngine, engine.isRunning {
            call.reject("Recorder already running")
            return
        }

        guard let sessionId = call.getString("sessionId"), !sessionId.isEmpty else {
            call.reject("Missing sessionId")
            return
        }

        let chunkDurationMs = call.getInt("chunkDurationMs") ?? 4000

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
            try audioSession.setActive(true, options: [])

            self.sessionId = sessionId
            self.startedAtMs = nowMs()
            self.chunkDurationMs = Int64(chunkDurationMs)
            self.chunkSeq = 0
            self.pending = []
            self.totalFramesCaptured = 0

            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.inputFormat(forBus: 0)
            self.sampleRate = format.sampleRate
            self.framesPerChunk = Int((Double(chunkDurationMs) / 1000.0) * sampleRate)
            try startNewChunkFile(sessionId: sessionId)

            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
                guard let self = self else { return }
                let frames = Int(buffer.frameLength)
                if frames <= 0 { return }

                guard let channel = buffer.floatChannelData?[0] else { return }
                var idx = 0
                while idx < frames {
                    guard let handle = self.currentChunkFileHandle else { return }
                    let remainingInChunk = max(0, self.framesPerChunk - self.currentChunkFrames)
                    let take = min(remainingInChunk, frames - idx)
                    if take <= 0 {
                        self.finalizeChunkIfNeeded(force: true)
                        do {
                            try self.startNewChunkFile(sessionId: sessionId)
                        } catch {
                            return
                        }
                        continue
                    }

                    var out = Data(count: take * 2)
                    out.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in
                        guard let ptr = raw.baseAddress?.assumingMemoryBound(to: Int16.self) else { return }
                        for i in 0..<take {
                            let s = max(-1.0, min(1.0, channel[idx + i]))
                            let v: Int16 = s < 0 ? Int16(s * 32768.0) : Int16(s * 32767.0)
                            ptr[i] = v.littleEndian
                        }
                    }
                    do {
                        try handle.write(contentsOf: out)
                    } catch {
                        return
                    }

                    idx += take
                    self.currentChunkFrames += take
                    self.totalFramesCaptured += Int64(take)
                    if self.currentChunkFrames >= self.framesPerChunk {
                        self.finalizeChunkIfNeeded(force: true)
                        do {
                            try self.startNewChunkFile(sessionId: sessionId)
                        } catch {
                            return
                        }
                    }
                }
            }

            try engine.start()
            self.audioEngine = engine

            call.resolve([
                "startedAtMs": self.startedAtMs ?? 0,
                "filePath": "",
            ])
        } catch let error {
            call.reject("Failed to start native recorder: \(error.localizedDescription)")
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        let isRecording = audioEngine?.isRunning ?? false
        let capturedMs: Int64 = Int64(Double(totalFramesCaptured) / sampleRate * 1000.0)
        call.resolve([
            "isRecording": isRecording,
            "startedAtMs": startedAtMs as Any,
            "capturedMs": capturedMs,
            "filePath": "" as Any,
            "pendingChunks": pending.count,
            "totalFramesCaptured": totalFramesCaptured,
        ])
    }

    @objc func stop(_ call: CAPPluginCall) {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        finalizeChunkIfNeeded(force: true)

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // best-effort
        }

        call.resolve([
            "capturedMs": Int64(Double(totalFramesCaptured) / sampleRate * 1000.0),
            "totalFramesCaptured": totalFramesCaptured,
            "sampleRate": Int(sampleRate),
        ])
    }

    @objc func consumeChunk(_ call: CAPPluginCall) {
        guard let requestedSessionId = call.getString("sessionId"), !requestedSessionId.isEmpty else {
            call.reject("Missing sessionId")
            return
        }
        if let activeSessionId = self.sessionId, activeSessionId != requestedSessionId {
            call.resolve([
                "chunk": NSNull(),
            ])
            return
        }
        if pending.isEmpty {
            call.resolve([
                "chunk": NSNull(),
            ])
            return
        }
        let first = pending.removeFirst()
        guard let filePath = first["filePath"] as? String else {
            call.resolve([
                "chunk": NSNull(),
            ])
            return
        }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let fileUrl = documents.appendingPathComponent(filePath, isDirectory: false)
        guard let data = try? Data(contentsOf: fileUrl) else {
            call.resolve([
                "chunk": NSNull(),
            ])
            return
        }
        let base64 = data.base64EncodedString()
        // Clean up file now that it’s been consumed.
        try? FileManager.default.removeItem(at: fileUrl)
        var payload = first
        payload["dataBase64"] = base64
        call.resolve([
            "chunk": payload,
        ])
    }
}

