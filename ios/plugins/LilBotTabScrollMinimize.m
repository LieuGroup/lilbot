// Workaround for software-mansion/react-native-screens#4145:
// On iOS 26, UITabBarController.tabBarMinimizeBehavior = .onScrollDown never engages when
// a tab hosts a nested native Stack because UIKit caches a one-shot contentScrollViewForEdge:
// pull before React Native mounts the list and does not traverse Fabric wrapper views.
// Delete this file and ios/plugins/with-tab-scroll-minimize.ts once react-native-screens
// resolves #4145 natively without requiring RNS_GAMMA_ENABLED=1.

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && defined(__IPHONE_26_0) && \
    __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_26_0 && !TARGET_OS_TV && !TARGET_OS_VISION

static const NSUInteger kLilBotMaxVisitedViews = 2000;
static const NSUInteger kLilBotMaxResponderHops = 64;
static Class sLilBotTabsScreenClass = Nil;
static Class sLilBotTabsScreenSuperclass = Nil;
static Class sLilBotScreenSuperclass = Nil;
static Class sLilBotScrollViewSuperclass = Nil;

static UIScrollView *LilBotCallSuperContentScrollView(UIViewController *self, SEL _cmd, Class superClass, NSDirectionalRectEdge edge) {
  if (superClass == Nil) return nil;
  struct objc_super superInfo = { .receiver = self, .super_class = superClass };
  UIScrollView *(*fn)(struct objc_super *, SEL, NSDirectionalRectEdge) =
      (UIScrollView *(*)(struct objc_super *, SEL, NSDirectionalRectEdge))objc_msgSendSuper;
  return fn(&superInfo, _cmd, edge);
}

static void LilBotCallSuperVoid(id self, SEL _cmd, Class superClass) {
  if (superClass == Nil) return;
  struct objc_super superInfo = { .receiver = self, .super_class = superClass };
  ((void (*)(struct objc_super *, SEL))objc_msgSendSuper)(&superInfo, _cmd);
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

static BOOL LilBotIsValidVerticalScrollView(UIScrollView *scrollView) {
  if (scrollView == nil || scrollView.isHidden || scrollView.alpha <= 0.01) return NO;
  if (scrollView.layer.transform.m22 < 0.0 || [scrollView isKindOfClass:UITextView.class] || !scrollView.scrollEnabled) return NO;
  CGSize contentSize = scrollView.contentSize;
  CGSize boundsSize = scrollView.bounds.size;
  BOOL horizontalOnly =
      (scrollView.alwaysBounceHorizontal && !scrollView.alwaysBounceVertical) ||
      (contentSize.width > boundsSize.width + 1.0 && contentSize.height <= boundsSize.height + 1.0);
  return !horizontalOnly;
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
    if ([view isKindOfClass:UIScrollView.class] && LilBotIsValidVerticalScrollView((UIScrollView *)view)) {
      return (UIScrollView *)view;
    }
    for (UIView *subview in view.subviews) {
      if (queue.count >= kLilBotMaxVisitedViews) break;
      [queue addObject:subview];
    }
  }
  return nil;
}

static UIView *LilBotTabScreenSearchRoot(UIViewController *tabScreenVC) {
  if (tabScreenVC == nil || !tabScreenVC.isViewLoaded) return nil;
  for (UIViewController *child in tabScreenVC.childViewControllers) {
    if ([child isKindOfClass:UINavigationController.class]) {
      UIViewController *top = ((UINavigationController *)child).topViewController;
      if (top == nil || !top.isViewLoaded) return nil;
      return top.view;
    }
  }
  return tabScreenVC.view;
}

static void LilBotSyncTabScreenScrollView(UIViewController *tabScreenVC) {
  if (tabScreenVC == nil || !tabScreenVC.isViewLoaded) return;
  if (@available(iOS 26.0, *)) {
    UIScrollView *current = LilBotCallSuperContentScrollView(
        tabScreenVC, @selector(contentScrollViewForEdge:), sLilBotTabsScreenSuperclass, NSDirectionalRectEdgeBottom);
    if (!LilBotShouldResolveForTabBar(tabScreenVC, NSDirectionalRectEdgeBottom)) {
      if (current != nil) [tabScreenVC setContentScrollView:nil forEdge:NSDirectionalRectEdgeBottom];
      return;
    }
    UIView *searchRoot = LilBotTabScreenSearchRoot(tabScreenVC);
    // O(1) steady-state fast path: skip BFS when the registered scroll view is still live inside searchRoot.
    if (current != nil && searchRoot != nil && current.window != nil &&
        LilBotIsValidVerticalScrollView(current) && [current isDescendantOfView:searchRoot]) {
      return;
    }
    UIScrollView *target = searchRoot != nil ? LilBotFindVerticalScrollView(searchRoot) : nil;
    if (current != target) [tabScreenVC setContentScrollView:target forEdge:NSDirectionalRectEdgeBottom];
  }
}

static UIScrollView *LilBotTabsScreenContentScrollViewForEdge(UIViewController *self, SEL _cmd, NSDirectionalRectEdge edge) {
  UIScrollView *superResult = LilBotCallSuperContentScrollView(self, _cmd, sLilBotTabsScreenSuperclass, edge);
  if (superResult != nil || !LilBotShouldResolveForTabBar(self, edge)) return superResult;
  if (@available(iOS 15.0, *)) {
    for (UIViewController *child in self.childViewControllers) {
      if ([child isKindOfClass:UINavigationController.class]) {
        UINavigationController *nav = (UINavigationController *)child;
        UIScrollView *nested = [nav contentScrollViewForEdge:edge] ?: [nav.topViewController contentScrollViewForEdge:edge];
        if (nested != nil) return nested;
      }
    }
    return LilBotFindVerticalScrollView(self.view);
  }
  return nil;
}

static void LilBotTabsScreenViewDidLayoutSubviews(UIViewController *self, SEL _cmd) {
  LilBotCallSuperVoid(self, _cmd, sLilBotTabsScreenSuperclass);
  LilBotSyncTabScreenScrollView(self);
}

static UIScrollView *LilBotScreenContentScrollViewForEdge(UIViewController *self, SEL _cmd, NSDirectionalRectEdge edge) {
  UIScrollView *superResult = LilBotCallSuperContentScrollView(self, _cmd, sLilBotScreenSuperclass, edge);
  if (superResult != nil || !LilBotShouldResolveForTabBar(self, edge) || !self.isViewLoaded) return superResult;
  if (self.navigationController == nil) return nil;
  return LilBotFindVerticalScrollView(self.view);
}

static void LilBotScrollViewDidMoveToWindow(UIView *self, SEL _cmd) {
  LilBotCallSuperVoid(self, _cmd, sLilBotScrollViewSuperclass);
  if (self.window == nil || sLilBotTabsScreenClass == Nil) return;
  UIResponder *responder = self.nextResponder;
  for (NSUInteger hops = 0; responder != nil && hops < kLilBotMaxResponderHops; hops++) {
    if ([responder isKindOfClass:sLilBotTabsScreenClass]) {
      __weak UIViewController *weakTabScreen = (UIViewController *)responder;
      dispatch_async(dispatch_get_main_queue(), ^{ LilBotSyncTabScreenScrollView(weakTabScreen); });
      return;
    }
    responder = responder.nextResponder;
  }
}

static BOOL LilBotInstallOverrideIfMissing(NSString *className, Class requiredSuper, SEL selector, IMP imp, Class *outSuperclass) {
  Class cls = NSClassFromString(className);
  if (cls == Nil || ![cls isSubclassOfClass:requiredSuper]) return NO;
  Method inherited = class_getInstanceMethod(requiredSuper, selector);
  const char *types = inherited != NULL ? method_getTypeEncoding(inherited) : NULL;
  Class superClass = class_getSuperclass(cls);
  if (types == NULL || superClass == Nil) return NO;
  if (outSuperclass != NULL) *outSuperclass = superClass;
  if (!class_addMethod(cls, selector, imp, types)) {
    if (outSuperclass != NULL) *outSuperclass = Nil;
    return NO;
  }
  return YES;
}

__attribute__((constructor))
static void LilBotInstallTabScrollMinimize(void) {
  if (@available(iOS 26.0, *)) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      SEL contentSel = @selector(contentScrollViewForEdge:);
      if (LilBotInstallOverrideIfMissing(@"RNSTabsScreenViewController", UIViewController.class, contentSel,
                                         (IMP)LilBotTabsScreenContentScrollViewForEdge, &sLilBotTabsScreenSuperclass)) {
        sLilBotTabsScreenClass = NSClassFromString(@"RNSTabsScreenViewController");
      }
      LilBotInstallOverrideIfMissing(@"RNSScreen", UIViewController.class, contentSel,
                                     (IMP)LilBotScreenContentScrollViewForEdge, &sLilBotScreenSuperclass);
      if (sLilBotTabsScreenClass != Nil) {
        LilBotInstallOverrideIfMissing(@"RNSTabsScreenViewController", UIViewController.class,
                                       @selector(viewDidLayoutSubviews), (IMP)LilBotTabsScreenViewDidLayoutSubviews, NULL);
        LilBotInstallOverrideIfMissing(@"RCTEnhancedScrollView", UIScrollView.class,
                                       @selector(didMoveToWindow), (IMP)LilBotScrollViewDidMoveToWindow, &sLilBotScrollViewSuperclass);
      }
    });
  }
}

#endif
