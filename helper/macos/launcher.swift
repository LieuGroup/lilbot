// The macOS app's main executable. It starts the bundled helper for this Mac's architecture: `setup` when the app
// is opened, `link` for a lilbot-helper:// link. Links arrive as Apple Events, which the helper itself cannot
// receive; the URL goes to the helper on stdin, never in its arguments.
import AppKit

final class Launcher: NSObject, NSApplicationDelegate {
  private var running = 0

  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls where url.scheme == "lilbot-helper" { start("link", input: url.absoluteString) }
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // A link that launched the app arrives just after launch; open the installer only when none did.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      if self.running == 0 { self.start("setup", input: nil) }
    }
  }

  private func start(_ action: String, input: String?) {
    #if arch(arm64)
      let name = "lilbot-helper-arm64"
    #else
      let name = "lilbot-helper-x64"
    #endif
    let process = Process()
    process.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/\(name)")
    process.arguments = [action]
    let pipe = Pipe()
    process.standardInput = pipe
    process.terminationHandler = { _ in
      DispatchQueue.main.async {
        self.running -= 1
        if self.running == 0 { NSApp.terminate(nil) }
      }
    }
    do { try process.run() } catch {
      if running == 0 { NSApp.terminate(nil) }
      return
    }
    running += 1
    if let input { pipe.fileHandleForWriting.write(Data(input.utf8)) }
    try? pipe.fileHandleForWriting.close()
  }
}

let app = NSApplication.shared
let launcher = Launcher()
app.delegate = launcher
app.setActivationPolicy(.accessory)
app.run()
