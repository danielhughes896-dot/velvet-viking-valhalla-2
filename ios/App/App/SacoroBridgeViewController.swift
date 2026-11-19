import UIKit
import Capacitor

/**
 * The app's own Capacitor bridge view controller, so the App target's local
 * plugins can be registered. Capacitor 8 finds plugins that ship as packages
 * by itself; a plugin that lives in the App target is registered here, on the
 * documented hook, capacitorDidLoad(), which runs once the bridge exists and
 * before the web view loads the page.
 *
 * Used by SceneDelegate (which builds the window) and Main.storyboard.
 */
class SacoroBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        /* App Store purchases (StoreKit 2). Its Transaction.updates listener
           starts here, at launch. */
        bridge?.registerPluginInstance(SacoroAppStorePlugin())
    }
}
