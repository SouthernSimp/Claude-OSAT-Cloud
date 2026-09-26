import SwiftUI

/// OSAT on the iPhone. The screens are the same web app as the Mac's (surface=phone);
/// this app gives them a window, the phone's own files and the OSAT folder in iCloud.
@main
struct OSATApp: App {
    var body: some Scene {
        WindowGroup {
            OSATWebView()
                .ignoresSafeArea()
        }
    }
}
