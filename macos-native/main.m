#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *const kAppBundleId = @"com.manastorm.tcg";
static NSString *const kSaveFileName = @"save_v1.json";
static NSString *const kSettingsFileName = @"settings_v1.json";

#pragma mark - Helper Functions

static NSString *ResolveAppDataDir(NSString *overrideDir) {
  if (overrideDir && overrideDir.length > 0) {
    [[NSFileManager defaultManager] createDirectoryAtPath:overrideDir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];
    return overrideDir;
  }
  NSArray<NSString *> *paths = NSSearchPathForDirectoriesInDomains(
      NSApplicationSupportDirectory, NSUserDomainMask, YES);
  NSString *baseDir = paths.firstObject ?: [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support"];
  NSString *appDir = [baseDir stringByAppendingPathComponent:kAppBundleId];
  [[NSFileManager defaultManager] createDirectoryAtPath:appDir
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:nil];
  return appDir;
}

static NSString *ResolveDistRootDir(void) {
  NSBundle *bundle = [NSBundle mainBundle];
  NSString *resPath = [bundle resourcePath];
  if (resPath) {
    NSString *bundledDist = [resPath stringByAppendingPathComponent:@"dist"];
    BOOL isDir = NO;
    if ([[NSFileManager defaultManager] fileExistsAtPath:bundledDist isDirectory:&isDir] && isDir) {
      return [bundledDist stringByStandardizingPath];
    }
  }
  // Fallback relative to executable path (e.g. during CLI testing)
  NSString *execPath = [[NSProcessInfo processInfo].arguments.firstObject stringByStandardizingPath];
  NSString *macosDir = [execPath stringByDeletingLastPathComponent];
  NSString *contentsDir = [macosDir stringByDeletingLastPathComponent];
  NSString *altDist = [[contentsDir stringByAppendingPathComponent:@"Resources/dist"] stringByStandardizingPath];
  return altDist;
}

static NSString *MimeTypeForPath(NSString *filePath) {
  NSString *ext = filePath.pathExtension.lowercaseString;
  if ([ext isEqualToString:@"html"] || [ext isEqualToString:@"htm"]) return @"text/html; charset=utf-8";
  if ([ext isEqualToString:@"css"]) return @"text/css; charset=utf-8";
  if ([ext isEqualToString:@"js"] || [ext isEqualToString:@"mjs"]) return @"application/javascript; charset=utf-8";
  if ([ext isEqualToString:@"json"]) return @"application/json; charset=utf-8";
  if ([ext isEqualToString:@"png"]) return @"image/png";
  if ([ext isEqualToString:@"svg"]) return @"image/svg+xml";
  if ([ext isEqualToString:@"ico"]) return @"image/x-icon";
  return @"application/octet-stream";
}

static NSString *SafeResolveDistFile(NSString *distRoot, NSString *urlPath) {
  NSString *cleanRoot = [distRoot stringByStandardizingPath];
  NSString *rel = urlPath ?: @"/";
  if ([rel hasPrefix:@"/"]) {
    rel = [rel substringFromIndex:1];
  }
  if (rel.length == 0) {
    rel = @"index.html";
  }
  // Reject any explicit parent traversal segments before and after standardization
  NSArray<NSString *> *parts = [rel pathComponents];
  for (NSString *part in parts) {
    if ([part isEqualToString:@".."]) {
      return nil;
    }
  }
  NSString *candidate = [[cleanRoot stringByAppendingPathComponent:rel] stringByStandardizingPath];
  NSString *rootWithSlash = [cleanRoot hasSuffix:@"/"] ? cleanRoot : [cleanRoot stringByAppendingString:@"/"];
  if (![candidate hasPrefix:rootWithSlash] && ![candidate isEqualToString:cleanRoot]) {
    return nil;
  }
  return candidate;
}

static NSDictionary *ExecuteStorageCommand(NSString *cmd, NSDictionary *args, NSString *appDataDir) {
  NSFileManager *fm = [NSFileManager defaultManager];
  NSString *savePath = [appDataDir stringByAppendingPathComponent:kSaveFileName];
  NSString *settingsPath = [appDataDir stringByAppendingPathComponent:kSettingsFileName];

  if ([cmd isEqualToString:@"desktop_load_save"]) {
    if (![fm fileExistsAtPath:savePath]) {
      return @{@"ok" : @YES, @"result" : [NSNull null]};
    }
    NSError *err = nil;
    NSString *content = [NSString stringWithContentsOfFile:savePath encoding:NSUTF8StringEncoding error:&err];
    if (err || !content) {
      return @{@"ok" : @NO, @"error" : err.localizedDescription ?: @"Failed to read save_v1.json"};
    }
    return @{@"ok" : @YES, @"result" : content};
  }

  if ([cmd isEqualToString:@"desktop_write_save"]) {
    NSString *payload = [args[@"payload"] isKindOfClass:[NSString class]] ? args[@"payload"] : @"";
    NSData *data = [payload dataUsingEncoding:NSUTF8StringEncoding];
    NSError *err = nil;
    BOOL wrote = [data writeToFile:savePath options:NSDataWritingAtomic error:&err];
    if (!wrote || err) {
      return @{@"ok" : @NO, @"error" : err.localizedDescription ?: @"Failed to write save_v1.json"};
    }
    return @{@"ok" : @YES, @"result" : @{@"ok" : @YES, @"bytes" : @(data.length)}};
  }

  if ([cmd isEqualToString:@"desktop_clear_save"]) {
    if ([fm fileExistsAtPath:savePath]) {
      NSError *err = nil;
      [fm removeItemAtPath:savePath error:&err];
      if (err) {
        return @{@"ok" : @NO, @"error" : err.localizedDescription};
      }
    }
    return @{@"ok" : @YES, @"result" : @{@"ok" : @YES, @"bytes" : @0}};
  }

  if ([cmd isEqualToString:@"desktop_load_settings"]) {
    if (![fm fileExistsAtPath:settingsPath]) {
      return @{@"ok" : @YES, @"result" : [NSNull null]};
    }
    NSError *err = nil;
    NSString *content = [NSString stringWithContentsOfFile:settingsPath encoding:NSUTF8StringEncoding error:&err];
    if (err || !content) {
      return @{@"ok" : @NO, @"error" : err.localizedDescription ?: @"Failed to read settings_v1.json"};
    }
    return @{@"ok" : @YES, @"result" : content};
  }

  if ([cmd isEqualToString:@"desktop_write_settings"]) {
    NSString *payload = [args[@"payload"] isKindOfClass:[NSString class]] ? args[@"payload"] : @"";
    NSData *data = [payload dataUsingEncoding:NSUTF8StringEncoding];
    NSError *err = nil;
    BOOL wrote = [data writeToFile:settingsPath options:NSDataWritingAtomic error:&err];
    if (!wrote || err) {
      return @{@"ok" : @NO, @"error" : err.localizedDescription ?: @"Failed to write settings_v1.json"};
    }
    return @{@"ok" : @YES, @"result" : @{@"ok" : @YES, @"bytes" : @(data.length)}};
  }

  return nil;
}

#pragma mark - Custom URL Scheme Handler (app://localhost/)

@interface ManastormSchemeHandler : NSObject <WKURLSchemeHandler>
@property(nonatomic, copy) NSString *distRoot;
@end

@implementation ManastormSchemeHandler

- (instancetype)initWithDistRoot:(NSString *)distRoot {
  self = [super init];
  if (self) {
    _distRoot = [distRoot copy];
  }
  return self;
}

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
  NSURL *url = urlSchemeTask.request.URL;
  NSString *targetFile = SafeResolveDistFile(self.distRoot, url.path);

  if (!targetFile || ![[NSFileManager defaultManager] fileExistsAtPath:targetFile]) {
    NSHTTPURLResponse *resp404 = [[NSHTTPURLResponse alloc] initWithURL:url
                                                             statusCode:404
                                                            HTTPVersion:@"HTTP/1.1"
                                                           headerFields:@{@"Content-Type" : @"text/plain"}];
    [urlSchemeTask didReceiveResponse:resp404];
    [urlSchemeTask didReceiveData:[@"Not Found" dataUsingEncoding:NSUTF8StringEncoding]];
    [urlSchemeTask didFinish];
    return;
  }

  NSData *data = [NSData dataWithContentsOfFile:targetFile];
  NSString *mime = MimeTypeForPath(targetFile);
  NSDictionary *headers = @{
    @"Content-Type" : mime,
    @"Content-Length" : [NSString stringWithFormat:@"%lu", (unsigned long)data.length],
    @"Access-Control-Allow-Origin" : @"*",
    @"Cache-Control" : @"no-store"
  };
  NSHTTPURLResponse *response = [[NSHTTPURLResponse alloc] initWithURL:url
                                                            statusCode:200
                                                           HTTPVersion:@"HTTP/1.1"
                                                          headerFields:headers];
  [urlSchemeTask didReceiveResponse:response];
  if (data) {
    [urlSchemeTask didReceiveData:data];
  }
  [urlSchemeTask didFinish];
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
  // No async tasks to cancel
}

@end

#pragma mark - Hardened WKWebView Subclass

@interface ManastormWebView : WKWebView
@end

@implementation ManastormWebView

- (void)willOpenMenu:(NSMenu *)menu withEvent:(NSEvent *)event {
  [menu removeAllItems];
}

- (void)mouseDown:(NSEvent *)event {
  NSPoint pt = [self convertPoint:event.locationInWindow fromView:nil];
  BOOL isFullScreen = (self.window.styleMask & NSWindowStyleMaskFullScreen) != 0;
  if (!isFullScreen && pt.y >= self.bounds.size.height - 30.0) {
    if (event.clickCount == 2) {
      [self.window performZoom:nil];
    } else {
      [self.window performWindowDragWithEvent:event];
    }
    return;
  }
  [super mouseDown:event];
}

@end

#pragma mark - Application Delegate & Bridge Handler

@interface ManastormAppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) ManastormWebView *webView;
@property(nonatomic, copy) NSString *appDataDir;
@property(nonatomic, copy) NSString *distRoot;
@property(nonatomic, assign) BOOL isFullScreen;
@end

@implementation ManastormAppDelegate

- (instancetype)init {
  self = [super init];
  if (self) {
    _appDataDir = [ResolveAppDataDir(nil) copy];
    _distRoot = [ResolveDistRootDir() copy];
    _isFullScreen = NO;
  }
  return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  [self buildMainMenu];

  NSRect frame = NSMakeRect(0, 0, 1440, 920);
  NSWindowStyleMask style = NSWindowStyleMaskTitled |
                            NSWindowStyleMaskClosable |
                            NSWindowStyleMaskMiniaturizable |
                            NSWindowStyleMaskResizable |
                            NSWindowStyleMaskFullSizeContentView;

  self.window = [[NSWindow alloc] initWithContentRect:frame
                                            styleMask:style
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
  self.window.title = @"MANASTORM — Tactical TCG Roguelike";
  self.window.titleVisibility = NSWindowTitleHidden;
  self.window.titlebarAppearsTransparent = YES;
  self.window.minSize = NSMakeSize(1024, 680);
  self.window.backgroundColor = [NSColor colorWithSRGBRed:16.0 / 255.0
                                                    green:14.0 / 255.0
                                                     blue:13.0 / 255.0
                                                    alpha:1.0];
  self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  self.window.collectionBehavior = NSWindowCollectionBehaviorFullScreenPrimary;
  self.window.delegate = self;
  [self.window center];
  [self.window setFrameAutosaveName:@"ManastormMainWindow"];

  WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
  ManastormSchemeHandler *schemeHandler = [[ManastormSchemeHandler alloc] initWithDistRoot:self.distRoot];
  [config setURLSchemeHandler:schemeHandler forURLScheme:@"app"];

  WKUserContentController *ucc = [[WKUserContentController alloc] init];
  [ucc addScriptMessageHandler:self name:@"manastormBridge"];

  NSString *bootScript =
    @"window.__MANASTORM_NATIVE__ = true;\n"
     "window.__MANASTORM_UNIFIED_TITLEBAR__ = true;\n"
     "document.addEventListener('DOMContentLoaded', function() {\n"
     "  if (document.body) { document.body.classList.add('desktop-app-mode', 'macos-unified-titlebar'); }\n"
     "}, { once: true });\n"
     "document.addEventListener('contextmenu', function(e) { e.preventDefault(); }, { capture: true });\n"
     "['gesturestart', 'gesturechange', 'gestureend'].forEach(function(evt) {\n"
     "  document.addEventListener(evt, function(e) { e.preventDefault(); }, { passive: false, capture: true });\n"
     "});\n"
     "document.addEventListener('wheel', function(e) {\n"
     "  if (e.ctrlKey || e.metaKey) { e.preventDefault(); }\n"
     "}, { passive: false, capture: true });\n";
  WKUserScript *userScript = [[WKUserScript alloc] initWithSource:bootScript
                                                    injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                 forMainFrameOnly:YES];
  [ucc addUserScript:userScript];
  config.userContentController = ucc;

  self.webView = [[ManastormWebView alloc] initWithFrame:self.window.contentView.bounds configuration:config];
  self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.webView.navigationDelegate = self;
  self.webView.allowsMagnification = NO;
  self.webView.allowsBackForwardNavigationGestures = NO;
  if ([self.webView respondsToSelector:@selector(setValue:forKey:)]) {
    @try {
      [self.webView setValue:@NO forKey:@"drawsBackground"];
    } @catch (NSException *_) {}
  }

  [self.window.contentView addSubview:self.webView];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];

  NSURL *indexUrl = [NSURL URLWithString:@"app://localhost/index.html"];
  [self.webView loadRequest:[NSURLRequest requestWithURL:indexUrl]];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return YES;
}

- (void)windowDidEnterFullScreen:(NSNotification *)notification {
  self.isFullScreen = YES;
  [self.webView evaluateJavaScript:@"if (document.body) document.body.classList.add('is-fullscreen');"
                 completionHandler:nil];
}

- (void)windowDidExitFullScreen:(NSNotification *)notification {
  self.isFullScreen = NO;
  [self.webView evaluateJavaScript:@"if (document.body) document.body.classList.remove('is-fullscreen');"
                 completionHandler:nil];
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  NSURL *url = navigationAction.request.URL;
  if (url && [url.scheme isEqualToString:@"app"]) {
    decisionHandler(WKNavigationActionPolicyAllow);
  } else {
    decisionHandler(WKNavigationActionPolicyCancel);
  }
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
  if (![message.body isKindOfClass:[NSDictionary class]]) return;
  NSDictionary *body = (NSDictionary *)message.body;
  NSNumber *reqId = body[@"id"] ?: @0;
  NSString *cmd = [body[@"cmd"] isKindOfClass:[NSString class]] ? body[@"cmd"] : @"";
  NSDictionary *args = [body[@"args"] isKindOfClass:[NSDictionary class]] ? body[@"args"] : @{};

  NSDictionary *storageRes = ExecuteStorageCommand(cmd, args, self.appDataDir);
  if (storageRes) {
    BOOL ok = [storageRes[@"ok"] boolValue];
    id payload = ok ? storageRes[@"result"] : storageRes[@"error"];
    [self replyIpcWithId:reqId ok:ok result:payload];
    return;
  }

  if ([cmd isEqualToString:@"desktop_get_info"]) {
    NSDictionary *info = @{
      @"runtime" : @"macos-native",
      @"platform" : @"macos",
      @"version" : @"1.0.0",
      @"appDataDir" : self.appDataDir ?: @"",
      @"fullscreen" : @(self.isFullScreen)
    };
    [self replyIpcWithId:reqId ok:YES result:info];
    return;
  }

  if ([cmd isEqualToString:@"desktop_toggle_fullscreen"]) {
    [self.window toggleFullScreen:nil];
    self.isFullScreen = !self.isFullScreen;
    [self replyIpcWithId:reqId ok:YES result:@{@"fullscreen" : @(self.isFullScreen)}];
    return;
  }

  if ([cmd isEqualToString:@"desktop_set_fullscreen"]) {
    BOOL desired = [args[@"fullscreen"] boolValue];
    if (desired != self.isFullScreen) {
      [self.window toggleFullScreen:nil];
      self.isFullScreen = desired;
    }
    [self replyIpcWithId:reqId ok:YES result:@{@"fullscreen" : @(self.isFullScreen)}];
    return;
  }

  if ([cmd isEqualToString:@"desktop_set_title"]) {
    NSString *title = [args[@"title"] isKindOfClass:[NSString class]] ? args[@"title"] : @"MANASTORM";
    self.window.title = title;
    [self replyIpcWithId:reqId ok:YES result:@{@"ok" : @YES}];
    return;
  }

  if ([cmd isEqualToString:@"desktop_quit_app"]) {
    [self replyIpcWithId:reqId ok:YES result:@{@"ok" : @YES}];
    dispatch_async(dispatch_get_main_queue(), ^{
      [NSApp terminate:nil];
    });
    return;
  }

  [self replyIpcWithId:reqId ok:NO result:[NSString stringWithFormat:@"Unknown command: %@", cmd]];
}

- (void)replyIpcWithId:(NSNumber *)reqId ok:(BOOL)ok result:(id)result {
  id safeResult = result ?: [NSNull null];
  NSDictionary *envelope = @{@"id" : reqId, @"ok" : @(ok), @"payload" : safeResult};
  NSData *jsonData = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:nil];
  if (!jsonData) return;
  NSString *jsonStr = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
  NSString *js = [NSString stringWithFormat:
    @"if (window.__MANASTORM_IPC_RESOLVE__) { const e = %@; window.__MANASTORM_IPC_RESOLVE__(e.id, e.ok, e.payload); }",
    jsonStr];
  [self.webView evaluateJavaScript:js completionHandler:nil];
}

#pragma mark - Native Menu Bar Actions

- (void)sendMenuAction:(NSString *)action {
  NSString *js = [NSString stringWithFormat:
    @"if (window.ManastormMenuCommand) window.ManastormMenuCommand('%@');", action];
  [self.webView evaluateJavaScript:js completionHandler:nil];
}

- (void)menuNewRun:(id)sender { [self sendMenuAction:@"new-run"]; }
- (void)menuViewLibrary:(id)sender { [self sendMenuAction:@"view-library"]; }
- (void)menuViewGraveyard:(id)sender { [self sendMenuAction:@"view-graveyard"]; }
- (void)menuOpenSettings:(id)sender { [self sendMenuAction:@"open-settings"]; }
- (void)menuZoomIn:(id)sender { [self sendMenuAction:@"zoom-in"]; }
- (void)menuZoomOut:(id)sender { [self sendMenuAction:@"zoom-out"]; }
- (void)menuZoomReset:(id)sender { [self sendMenuAction:@"zoom-reset"]; }

- (void)buildMainMenu {
  NSMenu *menubar = [[NSMenu alloc] init];
  [NSApp setMainMenu:menubar];

  // 1. App Menu
  NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
  [menubar addItem:appMenuItem];
  NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"MANASTORM"];
  [appMenu addItemWithTitle:@"About MANASTORM" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"Settings & Saves…" action:@selector(menuOpenSettings:) keyEquivalent:@","];
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"Hide MANASTORM" action:@selector(hide:) keyEquivalent:@"h"];
  [appMenu addItemWithTitle:@"Quit MANASTORM" action:@selector(terminate:) keyEquivalent:@"q"];
  [appMenuItem setSubmenu:appMenu];

  // 2. Game Menu
  NSMenuItem *gameMenuItem = [[NSMenuItem alloc] init];
  [menubar addItem:gameMenuItem];
  NSMenu *gameMenu = [[NSMenu alloc] initWithTitle:@"Game"];
  [gameMenu addItemWithTitle:@"New Run / Switch Deck…" action:@selector(menuNewRun:) keyEquivalent:@"n"];
  [gameMenu addItem:[NSMenuItem separatorItem]];
  [gameMenu addItemWithTitle:@"Inspect Library" action:@selector(menuViewLibrary:) keyEquivalent:@"l"];
  [gameMenu addItemWithTitle:@"Inspect Graveyard" action:@selector(menuViewGraveyard:) keyEquivalent:@"g"];
  [gameMenuItem setSubmenu:gameMenu];

  // 3. View Menu
  NSMenuItem *viewMenuItem = [[NSMenuItem alloc] init];
  [menubar addItem:viewMenuItem];
  NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
  NSMenuItem *fsItem = [[NSMenuItem alloc] initWithTitle:@"Toggle Full Screen"
                                                  action:@selector(toggleFullScreen:)
                                           keyEquivalent:@"f"];
  fsItem.keyEquivalentModifierMask = NSEventModifierFlagControl | NSEventModifierFlagCommand;
  [viewMenu addItem:fsItem];
  [viewMenu addItem:[NSMenuItem separatorItem]];
  [viewMenu addItemWithTitle:@"Zoom In" action:@selector(menuZoomIn:) keyEquivalent:@"="];
  [viewMenu addItemWithTitle:@"Zoom Out" action:@selector(menuZoomOut:) keyEquivalent:@"-"];
  [viewMenu addItemWithTitle:@"Actual Size (100%)" action:@selector(menuZoomReset:) keyEquivalent:@"0"];
  [viewMenuItem setSubmenu:viewMenu];

  // 4. Window Menu
  NSMenuItem *winMenuItem = [[NSMenuItem alloc] init];
  [menubar addItem:winMenuItem];
  NSMenu *winMenu = [[NSMenu alloc] initWithTitle:@"Window"];
  [winMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
  [winMenu addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
  [winMenuItem setSubmenu:winMenu];
}

@end

#pragma mark - Self-Test CLI Harness (--self-test)

static int RunNativeSelfTest(NSString *customDataDir) {
  NSString *distRoot = ResolveDistRootDir();
  NSString *dataDir = ResolveAppDataDir(customDataDir);
  NSFileManager *fm = [NSFileManager defaultManager];

  NSArray<NSString *> *requiredFiles = @[
    @"index.html", @"style.css", @"desktop.js", @"game.js",
    @"combat.js", @"mana.js", @"ui.js", @"data/cards.js", @"data/relics.js"
  ];

  for (NSString *rel in requiredFiles) {
    NSString *resolved = SafeResolveDistFile(distRoot, [@"/" stringByAppendingString:rel]);
    if (!resolved || ![fm fileExistsAtPath:resolved]) {
      fprintf(stderr, "SELF-TEST FAIL: Missing bundled asset %s in %s\n", rel.UTF8String, distRoot.UTF8String);
      return 1;
    }
  }

  // Verify path traversal is blocked
  NSString *traversal = SafeResolveDistFile(distRoot, @"/../../etc/passwd");
  if (traversal != nil) {
    fprintf(stderr, "SELF-TEST FAIL: Path traversal was not blocked\n");
    return 1;
  }

  // Verify MIME mapping
  if (![MimeTypeForPath(@"index.html") hasPrefix:@"text/html"] ||
      ![MimeTypeForPath(@"game.js") hasPrefix:@"application/javascript"] ||
      ![MimeTypeForPath(@"style.css") hasPrefix:@"text/css"]) {
    fprintf(stderr, "SELF-TEST FAIL: MIME type mapping mismatch\n");
    return 1;
  }

  // Verify atomic storage commands (save write, load, clear & settings write, load)
  NSString *sampleSave = @"{\"version\":1,\"archetypeId\":\"gruul_stompy\",\"playerLife\":25,\"gold\":12}";
  NSDictionary *wRes = ExecuteStorageCommand(@"desktop_write_save", @{@"payload" : sampleSave}, dataDir);
  if (![wRes[@"ok"] boolValue]) {
    fprintf(stderr, "SELF-TEST FAIL: desktop_write_save failed\n");
    return 1;
  }

  NSDictionary *lRes = ExecuteStorageCommand(@"desktop_load_save", @{}, dataDir);
  if (![lRes[@"ok"] boolValue] || ![lRes[@"result"] isEqualToString:sampleSave]) {
    fprintf(stderr, "SELF-TEST FAIL: desktop_load_save mismatch\n");
    return 1;
  }

  NSDictionary *cRes = ExecuteStorageCommand(@"desktop_clear_save", @{}, dataDir);
  NSDictionary *lResAfter = ExecuteStorageCommand(@"desktop_load_save", @{}, dataDir);
  if (![cRes[@"ok"] boolValue] || lResAfter[@"result"] != [NSNull null]) {
    fprintf(stderr, "SELF-TEST FAIL: desktop_clear_save did not remove save\n");
    return 1;
  }

  NSString *sampleSettings = @"{\"uiScale\":110,\"motionMode\":\"full\",\"fullscreen\":false}";
  ExecuteStorageCommand(@"desktop_write_settings", @{@"payload" : sampleSettings}, dataDir);
  NSDictionary *sRes = ExecuteStorageCommand(@"desktop_load_settings", @{}, dataDir);
  if (![sRes[@"ok"] boolValue] || ![sRes[@"result"] isEqualToString:sampleSettings]) {
    fprintf(stderr, "SELF-TEST FAIL: desktop_load_settings mismatch\n");
    return 1;
  }

  NSDictionary *report = @{
    @"ok" : @YES,
    @"runtime" : @"macos-native",
    @"arch" : @"arm64",
    @"distRoot" : distRoot,
    @"dataDir" : dataDir,
    @"verifiedAssets" : @(requiredFiles.count)
  };
  NSData *reportJson = [NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
  printf("%s\n", [[NSString alloc] initWithData:reportJson encoding:NSUTF8StringEncoding].UTF8String);
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSArray<NSString *> *args = [NSProcessInfo processInfo].arguments;
    if ([args containsObject:@"--self-test"]) {
      NSString *customDir = nil;
      NSUInteger idx = [args indexOfObject:@"--data-dir"];
      if (idx != NSNotFound && idx + 1 < args.count) {
        customDir = args[idx + 1];
      }
      return RunNativeSelfTest(customDir);
    }

    NSApplication *app = [NSApplication sharedApplication];
    ManastormAppDelegate *delegate = [[ManastormAppDelegate alloc] init];
    app.delegate = delegate;
    [app run];
  }
  return 0;
}
