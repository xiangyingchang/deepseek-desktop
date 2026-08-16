import AppKit
import Foundation
import WebKit

private let publicAppName = "DeepSeek Desktop (Unofficial)"

private struct ClientMetadata: Decodable {
    let id: String
    let storageId: String?
    let architecture: String?
    let appVersion: String?
    let updateChannel: String?
    let updateManifestURL: String?
    let profile: String
    let secrets: [String]
}

private struct UpdateAsset: Decodable {
    let arch: String
    let url: String
    let sha256: String
}

private struct UpdateManifest: Decodable {
    let schemaVersion: Int
    let distributionId: String
    let channel: String
    let appVersion: String
    let baseVersion: String
    let baseIntegrity: String
    let harnessVersion: String
    let minimumMacOS: String
    let assets: [UpdateAsset]
    let releaseNotesUrl: String?
}

private final class ReferenceAppDelegate: NSObject, NSApplicationDelegate {
    private let resourcesURL: URL
    private let metadata: ClientMetadata
    private let appDataURL: URL

    private var window: NSWindow?
    private var webView: WKWebView?
    private var runtime: Process?
    private var stdoutPipe: Pipe?
    private var stdoutBuffer = ""
    private var runtimeDiagnostics = ""
    private var didLoadWebUI = false
    private var stopping = false
    private var installingUpdate = false

    private init(resourcesURL: URL, metadata: ClientMetadata, appDataURL: URL) {
        self.resourcesURL = resourcesURL
        self.metadata = metadata
        self.appDataURL = appDataURL
        super.init()
    }

    static func make() -> ReferenceAppDelegate? {
        guard let resourcesURL = Bundle.main.resourceURL else { return nil }
        do {
            let data = try Data(contentsOf: resourcesURL.appendingPathComponent("client.json"))
            let metadata = try JSONDecoder().decode(ClientMetadata.self, from: data)
            guard let storageId = Self.safeStorageId(metadata.storageId ?? metadata.id) else { return nil }
            let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
            let appDataURL = applicationSupport
                .appendingPathComponent("DSH Stack", isDirectory: true)
                .appendingPathComponent(storageId, isDirectory: true)
            return ReferenceAppDelegate(resourcesURL: resourcesURL, metadata: metadata, appDataURL: appDataURL)
        } catch {
            return nil
        }
    }

    private static func safeStorageId(_ value: String) -> String? {
        guard value.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]*$", options: .regularExpression) != nil else { return nil }
        return value
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installApplicationMenu()
        showLoadingWindow()
        do {
            try prepareProfile()
            startRuntime()
        } catch {
            fail(error.localizedDescription)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopRuntime()
    }

    private func installApplicationMenu() {
        let mainMenu = NSMenu()

        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu(title: publicAppName)
        applicationMenu.addItem(
            withTitle: "Quit \(publicAppName)",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(
            withTitle: "Check for Updates…",
            action: #selector(checkForUpdates(_:)),
            keyEquivalent: ""
        )
        applicationMenu.addItem(
            withTitle: "Install Update…",
            action: #selector(installUpdate(_:)),
            keyEquivalent: ""
        )
        applicationItem.submenu = applicationMenu
        mainMenu.addItem(applicationItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        editMenu.items.last?.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func checkForUpdates(_ sender: Any?) {
        guard let feed = metadata.updateManifestURL,
              let feedURL = URL(string: feed),
              feedURL.scheme == "https" else {
            showUpdateAlert(
                title: "Update Check Unavailable",
                message: "This build has no trusted HTTPS Update Manifest configured. Use the official GitHub Release page to download updates manually."
            )
            return
        }
        var request = URLRequest(url: feedURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.showUpdateAlert(title: "Update Check Failed", message: error.localizedDescription)
                    return
                }
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), let data else {
                    self.showUpdateAlert(title: "Update Check Failed", message: "The Update Manifest could not be downloaded over HTTPS.")
                    return
                }
                self.handleUpdateManifest(data)
            }
        }.resume()
    }

    @objc private func installUpdate(_ sender: Any?) {
        guard !installingUpdate else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedFileTypes = ["app"]
        panel.message = "Choose the downloaded DeepSeek Desktop App from the mounted DMG."
        guard panel.runModal() == .OK, let candidateURL = panel.url else { return }
        installingUpdate = true
        let previousRuntime = runtime
        stopRuntime()
        waitForRuntimeExit(previousRuntime) { [weak self] in
            self?.launchUpdater(candidateURL: candidateURL)
        }
    }

    private func waitForRuntimeExit(_ process: Process?, completion: @escaping () -> Void) {
        guard let process else {
            completion()
            return
        }
        if !process.isRunning {
            completion()
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            guard let self else { return }
            self.waitForRuntimeExit(process, completion: completion)
        }
    }

    private func launchUpdater(candidateURL: URL) {
        let updater = Process()
        updater.executableURL = resourcesURL.appendingPathComponent("node")
        updater.arguments = [
            resourcesURL.appendingPathComponent("app-updater.mjs").path,
            "--candidate", candidateURL.path,
            "--active", Bundle.main.bundlePath,
            "--app-data", appDataURL.path,
            "--json",
        ]
        updater.currentDirectoryURL = resourcesURL
        var environment = ProcessInfo.processInfo.environment
        environment["DSH_HOME"] = appDataURL.path
        environment["DSH_STACK_ACTIVE_APP"] = Bundle.main.bundlePath
        environment["DSH_TELEMETRY_DISABLED"] = "1"
        updater.environment = environment
        let stderr = Pipe()
        updater.standardError = stderr
        updater.terminationHandler = { [weak self] process in
            let diagnostics = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            DispatchQueue.main.async {
                guard let self else { return }
                self.installingUpdate = false
                if process.terminationStatus == 0 {
                    let configuration = NSWorkspace.OpenConfiguration()
                    configuration.createsNewApplicationInstance = true
                    NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in }
                    NSApp.terminate(nil)
                    return
                }
                self.stopping = false
                self.didLoadWebUI = false
                let detail = diagnostics.trimmingCharacters(in: .whitespacesAndNewlines)
                self.showUpdateAlert(
                    title: "Update Not Installed",
                    message: detail.isEmpty ? "The candidate App failed verification. Your current App and User State were kept." : "The candidate App failed verification. Your current App and User State were kept.\n\n(detail)"
                )
                self.startRuntime()
            }
        }
        do {
            try updater.run()
        } catch {
            installingUpdate = false
            stopping = false
            didLoadWebUI = false
            showUpdateAlert(title: "Update Not Installed", message: error.localizedDescription)
            startRuntime()
        }
    }

    private func handleUpdateManifest(_ data: Data) {
        do {
            let manifest = try JSONDecoder().decode(UpdateManifest.self, from: data)
            guard manifest.schemaVersion == 1,
                  manifest.distributionId == metadata.id,
                  manifest.baseIntegrity.range(of: "^sha256-[a-fA-F0-9]{64}$", options: .regularExpression) != nil else {
                showUpdateAlert(title: "Update Rejected", message: "The Update Manifest does not belong to this DeepSeek Desktop Distribution.")
                return
            }
            let channel = metadata.updateChannel ?? "rc"
            guard manifest.channel == channel else {
                showUpdateAlert(title: "Update Rejected", message: "The Update Manifest channel does not match this App.")
                return
            }
            guard compareVersions(manifest.minimumMacOS, currentMacOSVersion) != .orderedDescending else {
                showUpdateAlert(title: "Update Unavailable", message: "This update requires macOS (manifest.minimumMacOS) or newer.")
                return
            }
            guard manifest.assets.filter({ $0.arch == currentArchitecture }).count == 1 else {
                showUpdateAlert(title: "Update Unavailable", message: "The Update Manifest does not contain exactly one (currentArchitecture) asset.")
                return
            }
            let asset = manifest.assets.first { $0.arch == currentArchitecture }
            guard let asset, let assetURL = URL(string: asset.url), assetURL.scheme == "https", asset.sha256.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else {
                showUpdateAlert(title: "Update Unavailable", message: "No trusted \(currentArchitecture) asset is available for this App.")
                return
            }
            let currentVersion = metadata.appVersion ?? "0.0.0"
            guard compareVersions(manifest.appVersion, currentVersion) == .orderedDescending else {
                showUpdateAlert(title: "No Updates Available", message: "DeepSeek Desktop \(currentVersion) is up to date on the \(currentArchitecture) channel.")
                return
            }
            let alert = NSAlert()
            alert.messageText = "Update Available"
            alert.informativeText = "DeepSeek Desktop \(manifest.appVersion) is available for this Mac. The release asset is for \(currentArchitecture); verify its published SHA-256 before manual installation. This RC build does not auto-install."
            alert.alertStyle = .informational
            alert.addButton(withTitle: "Download")
            alert.addButton(withTitle: "Later")
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(assetURL)
            }
        } catch {
            showUpdateAlert(title: "Update Rejected", message: "The Update Manifest is invalid or incomplete.")
        }
    }

    private func showUpdateAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    private var currentArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x64"
        #else
        return "unknown"
        #endif
    }

    private var currentMacOSVersion: String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "(version.majorVersion).(version.minorVersion).(version.patchVersion)"
    }

    private func compareVersions(_ left: String, _ right: String) -> ComparisonResult {
        func parse(_ value: String) -> ([Int], [String]) {
            let parts = value.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
            let numbers = parts.first?.split(separator: ".").map { Int($0) ?? 0 } ?? []
            let pre = parts.count > 1 ? String(parts[1]).split(separator: ".").map(String.init) : []
            return (Array(numbers.prefix(3)) + Array(repeating: 0, count: max(0, 3 - numbers.count)), pre)
        }
        let (leftNumbers, leftPre) = parse(left)
        let (rightNumbers, rightPre) = parse(right)
        for index in 0..<3 where leftNumbers[index] != rightNumbers[index] {
            return leftNumbers[index] > rightNumbers[index] ? .orderedDescending : .orderedAscending
        }
        if leftPre.isEmpty && rightPre.isEmpty { return .orderedSame }
        if leftPre.isEmpty { return .orderedDescending }
        if rightPre.isEmpty { return .orderedAscending }
        for index in 0..<min(leftPre.count, rightPre.count) where leftPre[index] != rightPre[index] {
            let leftNumber = Int(leftPre[index])
            let rightNumber = Int(rightPre[index])
            if let leftNumber, let rightNumber { return leftNumber > rightNumber ? .orderedDescending : .orderedAscending }
            if leftNumber != nil { return .orderedAscending }
            if rightNumber != nil { return .orderedDescending }
            return leftPre[index] > rightPre[index] ? .orderedDescending : .orderedAscending
        }
        if leftPre.count == rightPre.count { return .orderedSame }
        return leftPre.count > rightPre.count ? .orderedDescending : .orderedAscending
    }

    private func prepareProfile() throws {
        let fileManager = FileManager.default
        let profilesURL = appDataURL.appendingPathComponent("profiles", isDirectory: true)
        let profileURL = profilesURL.appendingPathComponent(metadata.profile, isDirectory: true)
        try fileManager.createDirectory(at: profilesURL, withIntermediateDirectories: true)
        if !fileManager.fileExists(atPath: profileURL.appendingPathComponent("package.json").path) {
            if fileManager.fileExists(atPath: profileURL.path) {
                throw NSError(domain: "DSHStackReference", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "The private Profile directory is incomplete: \(profileURL.path)"
                ])
            }
            try fileManager.copyItem(
                at: resourcesURL.appendingPathComponent("profile", isDirectory: true),
                to: profileURL
            )
        }
    }

    private func showLoadingWindow() {
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 720, height: 480))
        let spinner = NSProgressIndicator(frame: .zero)
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.isIndeterminate = true
        spinner.startAnimation(nil)
        let label = NSTextField(labelWithString: "Starting official DeepSeek Harness…")
        label.alignment = .center
        let stack = NSStackView(views: [spinner, label])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: content.centerYAnchor)
        ])

        let window = NSWindow(
            contentRect: content.bounds,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = publicAppName
        window.contentView = content
        window.center()
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    private func startRuntime() {
        let nodeURL = resourcesURL.appendingPathComponent("node")
        let runtimeScriptURL = resourcesURL.appendingPathComponent("reference-client.mjs")
        let child = Process()
        child.executableURL = nodeURL
        child.arguments = [runtimeScriptURL.path]
        child.currentDirectoryURL = resourcesURL
        var environment = ProcessInfo.processInfo.environment
        environment["HOME"] = NSHomeDirectory()
        environment["USER"] = NSUserName()
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        environment["DSH_HOME"] = appDataURL.path
        environment["DSH_STACK_ACTIVE_APP"] = Bundle.main.bundlePath
        environment["DSH_STACK_APP_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        environment["DSH_TELEMETRY_DISABLED"] = "1"
        // Let the official credentials-local provider own API keys. An
        // inherited `DEEPSEEK_API_KEY` is intentionally removed: Harness
        // correctly marks inherited environment credentials read-only, while
        // its managed `$DSH_HOME/.credentials.yaml` is editable from Models
        // and hot-reloads for the next request.
        for name in metadata.secrets { environment.removeValue(forKey: name) }
        child.environment = environment

        let stdout = Pipe()
        let stderr = Pipe()
        stdoutPipe = stdout
        child.standardOutput = stdout
        child.standardError = stderr
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.consumeRuntimeOutput(data)
        }
        stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.consumeRuntimeDiagnostics(data)
        }
        child.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self, !self.stopping, !self.didLoadWebUI else { return }
                self.fail("Official Harness stopped before its Web UI became ready (exit code \(process.terminationStatus)).")
            }
        }
        do {
            try child.run()
            runtime = child
        } catch {
            fail("Unable to start the embedded official Harness runtime: \(error.localizedDescription)")
        }
    }

    private func consumeRuntimeOutput(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        stdoutBuffer.append(text)
        while let newline = stdoutBuffer.firstIndex(of: "\n") {
            let line = String(stdoutBuffer[..<newline]).trimmingCharacters(in: .whitespacesAndNewlines)
            stdoutBuffer = String(stdoutBuffer[stdoutBuffer.index(after: newline)...])
            guard line.hasPrefix("DSH_STACK_READY ") else { continue }
            let address = String(line.dropFirst("DSH_STACK_READY ".count))
            DispatchQueue.main.async { [weak self] in self?.loadWebUI(address: address) }
        }
    }

    private func consumeRuntimeDiagnostics(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        runtimeDiagnostics = String((runtimeDiagnostics + text).suffix(4000))
    }

    private func loadWebUI(address: String) {
        guard let url = URL(string: address), url.scheme == "http", url.host == "127.0.0.1" else {
            fail("The official Harness returned an invalid local Web UI address.")
            return
        }
        let configuration = WKWebViewConfiguration()
        let view = WKWebView(frame: window?.contentView?.bounds ?? .zero, configuration: configuration)
        view.autoresizingMask = [.width, .height]
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: url))
        webView = view
        window?.contentView = view
        window?.title = "\(publicAppName) — DeepSeek Harness"
        didLoadWebUI = true
    }

    private func fail(_ message: String) {
        guard !stopping else { return }
        let details = runtimeDiagnostics.trimmingCharacters(in: .whitespacesAndNewlines)
        let suffix = details.isEmpty ? "" : "\n\nRuntime diagnostics:\n\(details)"
        stopRuntime()
        let alert = NSAlert()
        alert.messageText = "\(publicAppName) could not start"
        alert.informativeText = message + suffix
        alert.alertStyle = .critical
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func stopRuntime() {
        stopping = true
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        runtime?.terminate()
        runtime = nil
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
guard let delegate = ReferenceAppDelegate.make() else {
    application.terminate(nil)
    exit(1)
}
application.delegate = delegate
application.run()
