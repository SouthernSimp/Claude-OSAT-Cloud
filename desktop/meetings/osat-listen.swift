// OSAT's listening helper (Meetings, Phase 57). It hears the microphone and, if asked, the sound the Mac
// is playing, and appends each to a file as raw 16 kHz mono 16-bit little-endian sound: nothing else.
// No network, no notes, no analysis; OSAT (capture.cjs) starts it, and the words are made later.
//
//   osat-listen --mic <me.pcm> [--system <them.pcm>]
//
// It says what happened, one line each, on its output (capture.cjs reads them):
//   mic ok | mic denied | mic unavailable
//   system ok | system unavailable: permission | system unavailable: <why>
//   system lost: <why>
// and ends cleanly on SIGTERM or SIGINT, or when its input closes (OSAT quit or crashed).
//
// Built by scripts/build-listen.mjs: swiftc -swift-version 5 (macOS 13 or later: ScreenCaptureKit's sound).

import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation
import ScreenCaptureKit

func say(_ line: String) {
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

/// A file the sound is appended to (made private to the user), safe to write from any thread.
final class Sink {
    private let handle: FileHandle
    private let lock = NSLock()

    init?(path: String) {
        if !FileManager.default.fileExists(atPath: path) {
            guard FileManager.default.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600]) else { return nil }
        }
        guard let handle = FileHandle(forWritingAtPath: path) else { return nil }
        _ = try? handle.seekToEnd()
        self.handle = handle
    }

    func write(_ data: Data) {
        lock.lock()
        defer { lock.unlock() }
        // A full disk ends the write, not the helper: the meeting keeps what it has.
        try? handle.write(contentsOf: data)
    }

    func close() {
        lock.lock()
        defer { lock.unlock() }
        try? handle.synchronize()
        try? handle.close()
    }
}

/// Float samples (-1 to 1) as 16-bit little-endian sound.
func pcm16(_ samples: [Float]) -> Data {
    var out = [Int16](repeating: 0, count: samples.count)
    for i in 0..<samples.count {
        let v = max(-1, min(1, samples[i]))
        out[i] = Int16(v < 0 ? v * 32768 : v * 32767)
    }
    return out.withUnsafeBytes { Data($0) }
}

// MARK: the microphone

final class Microphone {
    private let engine = AVAudioEngine()
    private let sink: Sink

    init(sink: Sink) { self.sink = sink }

    func start() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: break
        case .notDetermined:
            let asked = DispatchSemaphore(value: 0)
            var allowed = false
            AVCaptureDevice.requestAccess(for: .audio) { granted in allowed = granted; asked.signal() }
            asked.wait()
            if !allowed { return "mic denied" }
        default: return "mic denied"
        }

        let input = engine.inputNode
        let from = input.outputFormat(forBus: 0)
        guard from.sampleRate > 0, from.channelCount > 0,
              let to = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
              let converter = AVAudioConverter(from: from, to: to)
        else { return "mic unavailable" }

        let sink = self.sink
        input.installTap(onBus: 0, bufferSize: 4096, format: from) { buffer, _ in
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * to.sampleRate / from.sampleRate) + 32
            guard let out = AVAudioPCMBuffer(pcmFormat: to, frameCapacity: capacity) else { return }
            var given = false
            var failure: NSError?
            converter.convert(to: out, error: &failure) { _, status in
                if given { status.pointee = .noDataNow; return nil }
                given = true
                status.pointee = .haveData
                return buffer
            }
            if failure == nil, out.frameLength > 0, let channel = out.int16ChannelData {
                sink.write(Data(bytes: channel[0], count: Int(out.frameLength) * MemoryLayout<Int16>.size))
            }
        }
        engine.prepare()
        do { try engine.start() } catch { return "mic unavailable" }
        return "mic ok"
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

// MARK: the sound the Mac plays

final class SystemSound: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let sink: Sink
    private let queue = DispatchQueue(label: "ai.mccreery.osat.listen.system")

    init(sink: Sink) { self.sink = sink }

    func start() async -> String {
        // The first time, macOS asks; until it is allowed, capture fails and the meeting goes on with the microphone.
        if !CGPreflightScreenCaptureAccess() {
            _ = CGRequestScreenCaptureAccess()
            return "system unavailable: permission"
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first else { return "system unavailable: no display" }
            let configuration = SCStreamConfiguration()
            configuration.capturesAudio = true
            configuration.excludesCurrentProcessAudio = true
            configuration.sampleRate = 16000
            configuration.channelCount = 1
            // Only the sound is wanted; the picture is as small and as rare as it can be made.
            configuration.width = 2
            configuration.height = 2
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            configuration.showsCursor = false
            let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: configuration, delegate: self)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            // A stream with no picture output logs a complaint for every frame; the tiny frames are simply dropped below.
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            try await stream.startCapture()
            self.stream = stream
            return "system ok"
        } catch {
            // -3801: the person said no (or has not yet said yes) to Screen & System Audio Recording.
            return (error as NSError).code == -3801 ? "system unavailable: permission" : "system unavailable: \(error.localizedDescription)"
        }
    }

    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let block = CMSampleBufferGetDataBuffer(sampleBuffer),
              let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let description = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee,
              description.mFormatID == kAudioFormatLinearPCM, description.mBitsPerChannel == 32,
              (description.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        else { return }

        let channels = max(1, Int(description.mChannelsPerFrame))
        let frames = CMSampleBufferGetNumSamples(sampleBuffer)
        var bytes = [UInt8](repeating: 0, count: CMBlockBufferGetDataLength(block))
        guard frames > 0, CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: bytes.count, destination: &bytes) == kCMBlockBufferNoErr else { return }

        let floats: [Float] = bytes.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        let separate = (description.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
        var mono = [Float](repeating: 0, count: frames)
        for i in 0..<frames {
            var sum: Float = 0
            for c in 0..<channels {
                let at = separate ? c * frames + i : i * channels + c
                if at < floats.count { sum += floats[at] }
            }
            mono[i] = sum / Float(channels)
        }
        sink.write(pcm16(mono))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        say("system lost: \(error.localizedDescription)")
    }
}

// MARK: running

var micPath: String?
var systemPath: String?
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
    if argument == "--mic" { micPath = arguments.next() }
    else if argument == "--system" { systemPath = arguments.next() }
}
guard let micPath, let micSink = Sink(path: micPath) else {
    say("mic unavailable")
    exit(1)
}

let microphone = Microphone(sink: micSink)
var system: SystemSound?
var systemSink: Sink?
if let systemPath { systemSink = Sink(path: systemPath) }

var signalSources: [DispatchSourceSignal] = []
var finishing = false
func finish() {
    if finishing { return }
    finishing = true
    Task {
        microphone.stop()
        await system?.stop()
        micSink.close()
        systemSink?.close()
        exit(0)
    }
}

for signalNumber in [SIGTERM, SIGINT] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
    source.setEventHandler { finish() }
    source.resume()
    // Held for the life of the program.
    signalSources.append(source)
}
FileHandle.standardInput.readabilityHandler = { handle in
    if handle.availableData.isEmpty { finish() }
}

Task {
    let mic = microphone.start()
    say(mic)
    if mic != "mic ok" { exit(1) }
    if let systemSink {
        let sound = SystemSound(sink: systemSink)
        system = sound
        say(await sound.start())
    }
}
dispatchMain()
