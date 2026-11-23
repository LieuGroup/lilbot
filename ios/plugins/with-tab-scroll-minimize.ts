/** Expo config plugin that works around software-mansion/react-native-screens#4145 so iOS 26
 *  `tabBarMinimizeBehavior="onScrollDown"` works when a NativeTabs tab hosts a nested native Stack.
 *  Controlled by `ENABLE_NESTED_TAB_SCROLL_MINIMIZE` in `ios/app.config.ts`. Delete both once
 *  react-native-screens resolves #4145 natively without `RNS_GAMMA_ENABLED=1`. */

export interface TabScrollMinimizeConfig {
  name?: string
  slug?: string
  plugins?: unknown[]
  [key: string]: unknown
}

export type WithBuildSourceFile = <T extends TabScrollMinimizeConfig>(
  config: T,
  props: { filePath: string; contents: string; overwrite?: boolean }
) => T

export interface TabScrollMinimizeOptions {
  enabled?: boolean
  withBuildSourceFile?: WithBuildSourceFile
}

declare function require(id: string): unknown

function defaultWithBuildSourceFile(): WithBuildSourceFile {
  // Loaded lazily so root-only TypeScript checks and unit tests can import this file
  // without `ios/node_modules` installed while Expo prebuild resolves `expo/config-plugins`.
  const mod = require('expo/config-plugins') as {
    IOSConfig: { XcodeProjectFile: { withBuildSourceFile: WithBuildSourceFile } }
  }
  return mod.IOSConfig.XcodeProjectFile.withBuildSourceFile
}

export const TAB_SCROLL_MINIMIZE_FILE = 'LilBotTabScrollMinimize.m'

export const TAB_SCROLL_MINIMIZE_SOURCE = `// Workaround for software-mansion/react-native-screens#4145:
// On iOS 26, UITabBarController.tabBarMinimizeBehavior = .onScrollDown never engages when
// a tab hosts a nested native Stack because UIKit's default contentScrollViewForEdge: stops
// at the stack container and does not traverse React Native Fabric wrapper views.
// Delete this file and ios/plugins/with-tab-scroll-minimize.ts once react-native-screens
// resolves #4145 natively without requiring RNS_GAMMA_ENABLED=1.

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && defined(__IPHONE_26_0) && \\
    __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0 && !TARGET_OS_TV && !TARGET_OS_VISION

static const NSUInteger kLilBotMaxVisitedViews = 2000;
static Class sLilBotTabsScreenSuperclass = Nil;
static Class sLilBotScreenSuperclass = Nil;

static UIScrollView *LilBotCallSuperContentScrollView(UIViewController *self,
                                                      SEL _cmd,
                                                      Class superClass,
                                                      NSDirectionalRectEdge edge) {
  if (superClass == Nil) return nil;
  struct objc_super superInfo = {
      .receiver = self,
      .super_class = superClass,
  };
  UIScrollView *(*msgSendSuper)(struct objc_super *, SEL, NSDirectionalRectEdge) =
      (UIScrollView *(*)(struct objc_super *, SEL, NSDirectionalRectEdge))objc_msgSendSuper;
  return msgSendSuper(&superInfo, _cmd, edge);
}

static BOOL LilBotShouldResolveForTabBar(UIViewController *vc, NSDirectionalRectEdge edge) {
  if ((edge & NSDirectionalRectEdgeBottom) == 0) return NO;
  if (@available(iOS 26.0, *)) {
    UITabBarController *tabBarController = vc.tabBarController;
    if (tabBarController == nil) return NO;
    return tabBarController.tabBarMinimizeBehavior != UITabBarMinimizeBehaviorNever;
  }
  return NO;
}

static UIScrollView *LilBotFindVerticalScrollView(UIView *rootView) {
  if (rootView == nil || rootView.isHidden || rootView.alpha <= 0.01) return nil;
  NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:rootView];
  NSUInteger head = 0;
  NSUInteger visited = 0;

  while (head < queue.count && visited < kLilBotMaxVisitedViews) {
    UIView *view = queue[head++];
    visited++;
    if (view.isHidden || view.alpha <= 0.01) continue;
    // Skip vertically inverted subtrees (such as React Native's inverted FlatList in Chat)
    // and multiline text inputs (UITextView subclasses UIScrollView).
    if (view.layer.transform.m22 < 0.0) continue;
    if ([view isKindOfClass:UITextView.class]) continue;

    if ([view isKindOfClass:UIScrollView.class]) {
      UIScrollView *scrollView = (UIScrollView *)view;
      if (scrollView.scrollEnabled) {
        CGSize contentSize = scrollView.contentSize;
        CGSize boundsSize = scrollView.bounds.size;
        BOOL horizontalOnly = contentSize.width > boundsSize.width + 1.0 &&
                              contentSize.height <= boundsSize.height + 1.0;
        if (!horizontalOnly) return scrollView;
      }
    }
    for (UIView *subview in view.subviews) {
      if (queue.count >= kLilBotMaxVisitedViews) break;
      [queue addObject:subview];
    }
  }
  return nil;
}

static UIScrollView *LilBotTabsScreenContentScrollViewForEdge(UIViewController *self,
                                                              SEL _cmd,
                                                              NSDirectionalRectEdge edge) {
  UIScrollView *superResult =
      LilBotCallSuperContentScrollView(self, _cmd, sLilBotTabsScreenSuperclass, edge);
  if (superResult != nil || !LilBotShouldResolveForTabBar(self, edge)) return superResult;
  if (@available(iOS 15.0, *)) {
    for (UIViewController *child in self.childViewControllers) {
      if ([child isKindOfClass:UINavigationController.class]) {
        UINavigationController *nav = (UINavigationController *)child;
        UIScrollView *nested =
            [nav contentScrollViewForEdge:edge] ?: [nav.topViewController contentScrollViewForEdge:edge];
        if (nested != nil) return nested;
      }
    }
  }
  return nil;
}

static UIScrollView *LilBotScreenContentScrollViewForEdge(UIViewController *self,
                                                          SEL _cmd,
                                                          NSDirectionalRectEdge edge) {
  UIScrollView *superResult =
      LilBotCallSuperContentScrollView(self, _cmd, sLilBotScreenSuperclass, edge);
  if (superResult != nil || !LilBotShouldResolveForTabBar(self, edge) || !self.isViewLoaded) {
    return superResult;
  }
  if (self.navigationController == nil) return nil;
  return LilBotFindVerticalScrollView(self.view);
}

static void LilBotInstallOverrideIfMissing(NSString *className,
                                           SEL selector,
                                           const char *types,
                                           IMP imp,
                                           Class *outSuperclass) {
  Class cls = NSClassFromString(className);
  if (cls == Nil || ![cls isSubclassOfClass:UIViewController.class]) return;
  Class superClass = class_getSuperclass(cls);
  if (superClass == Nil) return;
  *outSuperclass = superClass;
  if (!class_addMethod(cls, selector, imp, types)) {
    *outSuperclass = Nil;
  }
}

__attribute__((constructor))
static void LilBotInstallTabScrollMinimize(void) {
  if (@available(iOS 26.0, *)) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      SEL selector = @selector(contentScrollViewForEdge:);
      Method inherited = class_getInstanceMethod(UIViewController.class, selector);
      if (inherited == NULL) return;
      const char *types = method_getTypeEncoding(inherited);
      if (types == NULL) return;
      LilBotInstallOverrideIfMissing(@"RNSTabsScreenViewController",
                                     selector,
                                     types,
                                     (IMP)LilBotTabsScreenContentScrollViewForEdge,
                                     &sLilBotTabsScreenSuperclass);
      LilBotInstallOverrideIfMissing(@"RNSScreen",
                                     selector,
                                     types,
                                     (IMP)LilBotScreenContentScrollViewForEdge,
                                     &sLilBotScreenSuperclass);
    });
  }
}

#endif
`

export function withTabScrollMinimize<T extends TabScrollMinimizeConfig>(config: T, options: TabScrollMinimizeOptions = {}): T {
  if (options.enabled === false) return config
  const addSourceFile = options.withBuildSourceFile ?? defaultWithBuildSourceFile()
  return addSourceFile(config, {
    filePath: TAB_SCROLL_MINIMIZE_FILE,
    contents: TAB_SCROLL_MINIMIZE_SOURCE,
    overwrite: true
  })
}

export default withTabScrollMinimize
