#import <Capacitor/Capacitor.h>

CAP_PLUGIN(WWRecorder, "WWRecorder",
           CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(status, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)

