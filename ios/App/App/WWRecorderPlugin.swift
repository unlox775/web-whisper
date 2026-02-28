import Foundation
import AVFoundation
import Capacitor

@objc(WWRecorder)
public class WWRecorder: CAPPlugin {
    private var recorder: AVAudioRecorder?
    private var startedAtMs: Int64?
    private var filePath: String?

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

        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
            try audioSession.setActive(true, options: [])

            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
            let recordingsDir = documents.appendingPathComponent("WebWhisperRecordings", isDirectory: true)
            try FileManager.default.createDirectory(at: recordingsDir, withIntermediateDirectories: true)

            let fileUrl = recordingsDir.appendingPathComponent("\(sessionId).m4a", isDirectory: false)
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
            self.startedAtMs = Int64(Date().timeIntervalSince1970 * 1000.0)
            self.filePath = "WebWhisperRecordings/\(fileUrl.lastPathComponent)"

            call.resolve([
                "startedAtMs": self.startedAtMs ?? 0,
                "filePath": self.filePath ?? "",
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
            "filePath": filePath as Any,
        ])
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let recorder = recorder else {
            call.reject("Recorder not initialized")
            return
        }

        let capturedMs = Int64(recorder.currentTime * 1000.0)
        recorder.stop()
        self.recorder = nil

        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // best-effort
        }

        let fileBytes: Int64
        if let filePath = self.filePath {
            let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
            let fileUrl = documents.appendingPathComponent(filePath, isDirectory: false)
            let attrs = try? FileManager.default.attributesOfItem(atPath: fileUrl.path)
            fileBytes = (attrs?[FileAttributeKey.size] as? NSNumber)?.int64Value ?? 0
        } else {
            fileBytes = 0
        }

        call.resolve([
            "filePath": self.filePath ?? "",
            "capturedMs": capturedMs,
            "bytes": fileBytes,
        ])
    }
}

