import Foundation
import UIKit
import WebKit

/// What the page asks the phone for (see nativeBridge in src/store/bridges.js):
///   local.read / local.write   the app's own files: its workspace and where sync got to
///   cloud.status / cloud.list / cloud.read / cloud.write   the OSAT folder in iCloud Drive
/// and what it tells the page: cloud.changed when iCloud brings files, app.active.
/// Every file call runs on one queue, off the main thread.
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    private let queue = DispatchQueue(label: "ai.mccreery.osat.files")
    private let files = FileManager.default
    private var cloudLookedUp = false
    private var cloud: URL?
    private var query: NSMetadataQuery?
    private var observers: [NSObjectProtocol] = []

    private lazy var local: URL = {
        let base = self.files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OSAT", isDirectory: true)
        try? self.files.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }()

    enum BridgeError: LocalizedError {
        case badRequest(String)
        case noCloud

        var errorDescription: String? {
            switch self {
            case .badRequest(let what): return "OSAT couldn't do that (\(what))."
            case .noCloud: return "iCloud Drive is off on this iPhone."
            }
        }
    }

    override init() {
        super.init()
        observers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.send(event: "app.active")
        })
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? Int,
              let type = body["type"] as? String else { return }
        queue.async { [weak self] in
            guard let self else { return }
            do {
                self.reply(id: id, result: try self.handle(type, body), error: nil)
            } catch {
                self.reply(id: id, result: nil, error: error.localizedDescription)
            }
        }
    }

    private func handle(_ type: String, _ body: [String: Any]) throws -> Any? {
        switch type {
        case "local.read":
            return try read(local.appendingPathComponent(try localName(body["name"])))
        case "local.write":
            try write(local.appendingPathComponent(try localName(body["name"])), body["text"] as? String ?? "")
            return true
        case "cloud.status":
            return ["available": cloudRoot() != nil]
        case "cloud.list":
            return try list(try cloudPath(body["path"]))
        case "cloud.read":
            return try read(try cloudPath(body["path"]))
        case "cloud.write":
            try write(try cloudPath(body["path"]), body["text"] as? String ?? "")
            return true
        default:
            throw BridgeError.badRequest(type)
        }
    }

    // MARK: - Paths the page may use

    private func localName(_ value: Any?) throws -> String {
        guard let name = value as? String, ["workspace.json", "sync.json"].contains(name) else {
            throw BridgeError.badRequest("file name")
        }
        return name
    }

    /// Only plain relative paths inside the OSAT folder: letters, digits, . _ - and /.
    private func cloudPath(_ value: Any?) throws -> URL {
        guard let root = cloudRoot() else { throw BridgeError.noCloud }
        guard let path = value as? String, !path.isEmpty, !path.hasPrefix("/"),
              path.range(of: "^[A-Za-z0-9._/-]+$", options: .regularExpression) != nil,
              !path.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else {
            throw BridgeError.badRequest("path")
        }
        return root.appendingPathComponent(path)
    }

    /// The app's iCloud folder (Documents in its container), looked up once, off the main thread.
    private func cloudRoot() -> URL? {
        if !cloudLookedUp {
            cloudLookedUp = true
            if let container = files.url(forUbiquityContainerIdentifier: nil) {
                let documents = container.appendingPathComponent("Documents", isDirectory: true)
                try? files.createDirectory(at: documents, withIntermediateDirectories: true)
                cloud = documents
                DispatchQueue.main.async { [weak self] in self?.watchCloud() }
            }
        }
        return cloud
    }

    // MARK: - Files

    /// A file's text, or nil when it isn't there yet (iCloud is asked to bring it).
    private func read(_ url: URL) throws -> Any? {
        if !files.fileExists(atPath: url.path) {
            if url.path.hasPrefix(cloud?.path ?? "\u{0}") {
                try? files.startDownloadingUbiquitousItem(at: url)
            }
            return NSNull()
        }
        var text: String?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readable in
            text = try? String(contentsOf: readable, encoding: .utf8)
        }
        if let coordinationError { throw coordinationError }
        if let text { return text }
        return NSNull()
    }

    private func write(_ url: URL, _ text: String) throws {
        try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var failure: Error?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { writable in
            do {
                try Data(text.utf8).write(to: writable, options: .atomic)
            } catch {
                failure = error
            }
        }
        if let coordinationError { throw coordinationError }
        if let failure { throw failure }
    }

    /// Names in a folder. Files iCloud hasn't brought yet show as ".name.icloud";
    /// they are listed by their real name and asked for.
    private func list(_ url: URL) throws -> [String] {
        guard let names = try? files.contentsOfDirectory(atPath: url.path) else { return [] }
        return names.compactMap { name in
            if name.hasPrefix("."), name.hasSuffix(".icloud") {
                let real = String(name.dropFirst().dropLast(".icloud".count))
                try? files.startDownloadingUbiquitousItem(at: url.appendingPathComponent(real))
                return real
            }
            return name.hasPrefix(".") ? nil : name
        }
    }

    // MARK: - Talking to the page

    private func reply(id: Int, result: Any?, error: String?) {
        let payload: [Any] = [id, result ?? NSNull(), error.map { $0 as Any } ?? NSNull()]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.osatNative && window.osatNative.reply(...\(json))")
        }
    }

    private func send(event: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.osatNative && window.osatNative.event('\(event)')")
        }
    }

    /// iCloud tells the app when files in its folder change; the page then reads them.
    private func watchCloud() {
        guard query == nil else { return }
        let query = NSMetadataQuery()
        query.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        query.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
        for name in [Notification.Name.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: query, queue: .main) { [weak self] _ in
                self?.send(event: "cloud.changed")
            })
        }
        query.start()
        self.query = query
    }
}
