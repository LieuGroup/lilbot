/** Expo config plugin enabling iOS 27.1+ `UIBarButtonItemAxisBehaviorVerticalPreferred` on native
 *  `RNSBarButtonItem` instances whose `identifier` starts with `lilbot.duo.vertical.`.
 *  Controlled by `ENABLE_DUO_VERTICAL_BAR_ITEMS` in `ios/app.config.ts`. Public UIKit API only,
 *  guarded by SDK + runtime `@available(iOS 27.1, *)`, and a strict no-op on iOS < 27.1, ordinary iPhones,
 *  and iPads (or any bar item without the Duo vertical prefix). Delete once `react-native-screens`
 *  exposes `axisBehavior` natively. */

export const DUO_VERTICAL_BAR_FILE = 'LilBotDuoVerticalBar.m'
export const DUO_VERTICAL_ITEM_PREFIX = 'lilbot.duo.vertical.'

export interface DuoVerticalBarConfig {
  name?: string
  slug?: string
  plugins?: unknown[]
  [key: string]: unknown
}

export type WithBuildSourceFile = <T extends DuoVerticalBarConfig>(
  config: T,
  props: { filePath: string; contents: string; overwrite?: boolean }
) => T

export interface DuoVerticalBarOptions {
  enabled?: boolean
  withBuildSourceFile?: WithBuildSourceFile
}

declare function require(id: string): unknown

function defaultWithBuildSourceFile(): WithBuildSourceFile {
  const mod = require('expo/config-plugins') as {
    IOSConfig: { XcodeProjectFile: { withBuildSourceFile: WithBuildSourceFile } }
  }
  return mod.IOSConfig.XcodeProjectFile.withBuildSourceFile
}

export const DUO_VERTICAL_BAR_SOURCE = `// Enables iOS 27.1+ UIBarButtonItemAxisBehaviorVerticalPreferred on native RNSBarButtonItem
// instances opted in via the "${DUO_VERTICAL_ITEM_PREFIX}" identifier prefix.
// Strictly public UIKit API, guarded at compile time (__IPHONE_27_1) and runtime (@available(iOS 27.1, *)),
// using additive class_addMethod only (no swizzling, no private selectors).
// Delete this file and ios/plugins/with-duo-vertical-bar.ts once react-native-screens exposes axisBehavior natively.

#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && defined(__IPHONE_27_1) && \\
    __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_27_1 && !TARGET_OS_TV && !TARGET_OS_VISION

static NSString *const kLilBotDuoVerticalPrefix = @"${DUO_VERTICAL_ITEM_PREFIX}";
static Class sLilBotBarButtonSuperclass = Nil;

static void LilBotBarButtonSetIdentifier(UIBarButtonItem *self, SEL _cmd, NSString *identifier) {
  if (sLilBotBarButtonSuperclass != Nil) {
    struct objc_super superInfo = { .receiver = self, .super_class = sLilBotBarButtonSuperclass };
    ((void (*)(struct objc_super *, SEL, NSString *))objc_msgSendSuper)(&superInfo, _cmd, identifier);
  }
  if (@available(iOS 27.1, *)) {
    if (identifier != nil && [identifier hasPrefix:kLilBotDuoVerticalPrefix]) {
      self.axisBehavior = UIBarButtonItemAxisBehaviorVerticalPreferred;
    }
  }
}

__attribute__((constructor))
static void LilBotInstallDuoVerticalBarItems(void) {
  if (@available(iOS 27.1, *)) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      Class cls = NSClassFromString(@"RNSBarButtonItem");
      if (cls == Nil || ![cls isSubclassOfClass:UIBarButtonItem.class]) return;
      SEL selector = @selector(setIdentifier:);
      Method inherited = class_getInstanceMethod(UIBarButtonItem.class, selector);
      const char *types = inherited != NULL ? method_getTypeEncoding(inherited) : NULL;
      Class superClass = class_getSuperclass(cls);
      if (types == NULL || superClass == Nil) return;
      sLilBotBarButtonSuperclass = superClass;
      if (!class_addMethod(cls, selector, (IMP)LilBotBarButtonSetIdentifier, types)) {
        sLilBotBarButtonSuperclass = Nil;
      }
    });
  }
}

#endif
`

export function withDuoVerticalBar<T extends DuoVerticalBarConfig>(config: T, options: DuoVerticalBarOptions = {}): T {
  if (options.enabled === false) return config
  const addSourceFile = options.withBuildSourceFile ?? defaultWithBuildSourceFile()
  return addSourceFile(config, {
    filePath: DUO_VERTICAL_BAR_FILE,
    contents: DUO_VERTICAL_BAR_SOURCE,
    overwrite: true
  })
}

export default withDuoVerticalBar
