// osat-blur: a tiny Node-API module the desk loads in the main process (desktop/main.cjs `deskBlur`) for a real,
// adjustable blur of whatever is behind the desk. macOS's vibrancy has one fixed blur; this sets the window server's
// own background blur radius on the desk's window (the call iTerm2 and Ghostty use for their blur settings).
// It touches only OSAT's own window, needs no permission, reads nothing and keeps nothing.
// Built by scripts/build-helpers.mjs into build/helpers/osat-blur.node (a bundle; Node-API resolved when loaded).
#import <Cocoa/Cocoa.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// The few Node-API calls used (their C ABI is stable across Node and Electron), declared here so no headers are needed.
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);
extern napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
extern napi_status napi_get_buffer_info(napi_env, napi_value, void **, size_t *);
extern napi_status napi_get_value_int32(napi_env, napi_value, int32_t *);
extern napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
extern napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
extern napi_status napi_get_boolean(napi_env, bool, napi_value *);

typedef int32_t CGSConnectionID;
extern CGSConnectionID CGSMainConnectionID(void);
extern int32_t CGSSetWindowBackgroundBlurRadius(CGSConnectionID connection, int32_t windowNumber, int32_t radius);

// setBlur(handle: Buffer from BrowserWindow.getNativeWindowHandle(), radius: 0…100) → true when the window took it.
static napi_value setBlur(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_value result;
  bool ok = false;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) == 0 && argc == 2) {
    void *data = NULL;
    size_t length = 0;
    int32_t radius = 0;
    if (napi_get_buffer_info(env, argv[0], &data, &length) == 0 && data && length >= sizeof(void *) && napi_get_value_int32(env, argv[1], &radius) == 0) {
      NSView *view = (__bridge NSView *)(*(void **)data);
      NSWindow *window = [view isKindOfClass:[NSView class]] ? view.window : nil;
      if (window) {
        radius = radius < 0 ? 0 : radius > 100 ? 100 : radius;
        ok = CGSSetWindowBackgroundBlurRadius(CGSMainConnectionID(), (int32_t)window.windowNumber, radius) == 0;
      }
    }
  }
  napi_get_boolean(env, ok, &result);
  return result;
}

__attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "setBlur", SIZE_MAX, setBlur, NULL, &fn) == 0) napi_set_named_property(env, exports, "setBlur", fn);
  return exports;
}
__attribute__((visibility("default"))) int32_t node_api_module_get_api_version_v1(void) { return 8; }
