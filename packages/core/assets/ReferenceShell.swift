import AppKit
import Security
import WebKit

private struct ClientMetadata: Decodable {
    let id: String
    let profile: String
    let secrets: [String]
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
            let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
            let appDataURL = applicationSupport
                .appendingPathComponent("DSH Stack", isDirectory: true)
                .appendingPathComponent(metadata.id, isDirectory: true)
            return ReferenceAppDelegate(resourcesURL: resourcesURL, metadata: metadata, appDataURL: appDataURL)
        } catch {
            return nil
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        showLoadingWindow()
        do {
            try prepareProfile()
            var secrets: [String: String] = [:]
            for name in metadata.secrets {
                secrets[name] = try resolveSecret(name)
            }
            startRuntime(secrets: secrets)
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

    private func serviceName(for secret: String) -> String {
        "dsh-stack:\(metadata.id):\(secret)"
    }

    private func keychainRead(service: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: NSUserName(),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    private func keychainWrite(service: String, value: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: NSUserName()
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(updateStatus), userInfo: nil)
        }
        var item = query
        item[kSecValueData as String] = data
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        if addStatus != errSecSuccess {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus), userInfo: nil)
        }
    }

    private func resolveSecret(_ name: String) throws -> String {
        let environment = ProcessInfo.processInfo.environment
        if let value = environment[name], !value.isEmpty { return value }
        if let value = keychainRead(service: serviceName(for: name)), !value.isEmpty { return value }

        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
        field.placeholderString = name
        let alert = NSAlert()
        alert.messageText = "Configure \(name)"
        alert.informativeText = "This key is stored in macOS Keychain and is not written to the Stack artifact."
        alert.accessoryView = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else {
            throw NSError(domain: "DSHStackReference", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Configuration cancelled: \(name) is required."
            ])
        }
        let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            throw NSError(domain: "DSHStackReference", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "No value was entered for \(name)."
            ])
        }
        try keychainWrite(service: serviceName(for: name), value: value)
        return value
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
        window.title = "DSH Stack Reference"
        window.contentView = content
        window.center()
        window.isReleasedWhenClosed = false
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        self.window = window
    }

    private func startRuntime(secrets: [String: String]) {
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
        environment["DSH_TELEMETRY_DISABLED"] = "1"
        for (name, value) in secrets { environment[name] = value }
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
        window?.title = "DSH Stack Reference — DeepSeek Harness"
        didLoadWebUI = true
    }

    private func fail(_ message: String) {
        guard !stopping else { return }
        let details = runtimeDiagnostics.trimmingCharacters(in: .whitespacesAndNewlines)
        let suffix = details.isEmpty ? "" : "\n\nRuntime diagnostics:\n\(details)"
        stopRuntime()
        let alert = NSAlert()
        alert.messageText = "DSH Stack Reference could not start"
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
