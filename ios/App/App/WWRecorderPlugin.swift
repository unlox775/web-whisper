import Foundation
import AVFoundation
import Capacitor

@objc(WWRecorder)
public class WWRecorder: CAPPlugin {
    private var recorder: AVAudioRecorder?
    private var startedAtMs: Int64?
    private var sessionId: String?
    private var chunkDurationMs: Int64 = 4000
    private var chunkSeq: Int = 0
    private var chunkStartedAtMs: Int64?
    private var rotationTimer: DispatchSourceTimer?
    private var pending: [[String: Any]] = []

    private func recordingsDirUrl() -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return documents.appendingPathComponent("WebWhisperRecordings", isDirectory: true)
    }

    private func chunkFileUrl(sessionId: String, seq: Int) -> URL {
        let filename = String(format: "%@-chunk-%05d.m4a", sessionId, seq)
        return recordingsDirUrl().appendingPathComponent(filename, isDirectory: false)
    }

    private func nowMs() -> Int64 {
        return Int64(Date().timeIntervalSince1970 * 1000.0)
    }

    private func startChunkRecorder(sessionId: String, targetBitrate: Int) throws {
        let dir = recordingsDirUrl()
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let fileUrl = chunkFileUrl(sessionId: sessionId, seq: chunkSeq)
        if FileManager.default.fileExists(atPath: fileUrl.path) {
            try FileManager.default.removeItem(at: fileUrl)
        }

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: targetBitrate,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder = try AVAudioRecorder(url: fileUrl, settings: settings)
        recorder.isMeteringEnabled = true
        recorder.prepareToRecord()
        recorder.record()
        self.recorder = recorder
        self.chunkStartedAtMs = nowMs()
    }

    private func finalizeActiveChunk() {
        guard let recorder = recorder, let sessionId = sessionId, let chunkStartedAtMs = chunkStartedAtMs else {
            return
        }
        let seq = chunkSeq
        let capturedMs = Int64(recorder.currentTime * 1000.0)
        recorder.stop()
        self.recorder = nil

        let startMs = chunkStartedAtMs
        let endMs = startMs + capturedMs
        let fileUrl = chunkFileUrl(sessionId: sessionId, seq: seq)
        let attrs = try? FileManager.default.attributesOfItem(atPath: fileUrl.path)
        let bytes = (attrs?[FileAttributeKey.size] as? NSNumber)?.intValue ?? 0

        if bytes > 0 && endMs > startMs {
            pending.append([
                "sessionId": sessionId,
                "seq": seq,
                "startMs": startMs,
                "endMs": endMs,
                "bytes": bytes,
                "filePath": "WebWhisperRecordings/\(fileUrl.lastPathComponent)",
            ])
        }

        chunkSeq += 1
        self.chunkStartedAtMs = nil
    }

    @objc func start(_ call: CAPPluginCall) {
        if let recorder = recorder, recorder.isRecording {
            call.reject("Recorder already running")
            return
        }

        guard let sessionId = call.getString("sessionId"), !sessionId.isEmpty else {
            call.reject("Missing sessionId")
            return
        }

        let targetBitrate = call.getInt("targetBitrate") ?? 64000
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

            try startChunkRecorder(sessionId: sessionId, targetBitrate: targetBitrate)

            rotationTimer?.cancel()
            let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
            timer.schedule(deadline: .now() + .milliseconds(chunkDurationMs), repeating: .milliseconds(chunkDurationMs))
            timer.setEventHandler { [weak self] in
                guard let self = self else { return }
                // Rotate chunk in the background-safe native layer.
                self.finalizeActiveChunk()
                guard let sessionId = self.sessionId else { return }
                do {
                    try self.startChunkRecorder(sessionId: sessionId, targetBitrate: targetBitrate)
                } catch {
                    // If restart fails, leave pending chunks; status/stop will reflect isRecording=false.
                }
            }
            rotationTimer = timer
            timer.resume()

            call.resolve([
                "startedAtMs": self.startedAtMs ?? 0,
                "filePath": "",
            ])
        } catch let error {
            call.reject("Failed to start native recorder: \(error.localizedDescription)")
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        let isRecording = recorder?.isRecording ?? false
        let capturedMs: Int64 = isRecording ? Int64((recorder?.currentTime ?? 0) * 1000.0) : 0
        call.resolve([
            "isRecording": isRecording,
            "startedAtMs": startedAtMs as Any,
            "capturedMs": capturedMs,
            "filePath": "" as Any,
            "pendingChunks": pending.count,
        ])
    }

    @objc func stop(_ call: CAPPluginCall) {
        rotationTimer?.cancel()
        rotationTimer = nil
        finalizeActiveChunk()

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // best-effort
        }

        call.resolve([
            "capturedMs": Int64(max(0, (nowMs() - (startedAtMs ?? nowMs())))),
        ])
    }

    @objc func consumeChunk(_ call: CAPPluginCall) {
        guard let requestedSessionId = call.getString("sessionId"), !requestedSessionId.isEmpty else {
            call.reject("Missing sessionId")
            return
        }
        if pending.isEmpty {
            call.resolve(nil)
            return
        }
        let first = pending.removeFirst()
        guard let filePath = first["filePath"] as? String else {
            call.resolve(nil)
            return
        }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let fileUrl = documents.appendingPathComponent(filePath, isDirectory: false)
        guard let data = try? Data(contentsOf: fileUrl) else {
            call.resolve(nil)
            return
        }
        let base64 = data.base64EncodedString()
        // Clean up file now that it’s been consumed.
        try? FileManager.default.removeItem(at: fileUrl)
        var payload = first
        payload["dataBase64"] = base64
        call.resolve(payload)
    }
}

