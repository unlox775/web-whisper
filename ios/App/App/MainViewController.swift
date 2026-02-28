import Capacitor

class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        bridge?.registerPluginInstance(WWRecorderPlugin())
    }
}

