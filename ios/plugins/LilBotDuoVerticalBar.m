// Enables iOS 27.1+ UIBarButtonItemAxisBehaviorVerticalPreferred on native bar items
// opted in via the "lilbot.duo.vertical." identifier prefix (both RNSBarButtonItem and
// RNSScreenStackHeaderSubview custom-view bar items).
// Strictly public UIKit API, guarded at compile time (__IPHONE_27_1) and runtime
// (@available(iOS 27.1, *)), using additive class_addMethod only (no swizzling, no private selectors).
// Delete this file and ios/plugins/with-duo-vertical-bar.ts once react-native-screens exposes axisBehavior natively.

#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

#if defined(__IPHONE_OS_VERSION_MAX_ALLOWED) && defined(__IPHONE_27_1) && \
    __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_27_1 && !TARGET_OS_TV && !TARGET_OS_VISION

static NSString *const kLilBotDuoVerticalPrefix = @"lilbot.duo.vertical.";
static const NSUInteger kLilBotMaxViewSearchNodes = 24;
static Class sLilBotBarButtonSuperclass = Nil;
static Class sLilBotScreenSuperclass = Nil;
static Class sLilBotHeaderSubviewWindowSuperclass = Nil;
static Class sLilBotHeaderSubviewAddSuperclass = Nil;

static BOOL LilBotViewSubtreeHasVerticalPrefix(UIView *root) {
  if (root == nil) return NO;
  NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:root];
  NSUInteger cursor = 0;
  while (cursor < queue.count && cursor < kLilBotMaxViewSearchNodes) {
    UIView *current = queue[cursor++];
    NSString *ident = current.accessibilityIdentifier;
    if (ident != nil && [ident hasPrefix:kLilBotDuoVerticalPrefix]) {
      return YES;
    }
    for (UIView *child in current.subviews) {
      if (queue.count >= kLilBotMaxViewSearchNodes) break;
      [queue addObject:child];
    }
  }
  return NO;
}

static BOOL LilBotApplyVerticalBehaviorToItems(NSArray<UIBarButtonItem *> *items) API_AVAILABLE(ios(27.1)) {
  BOOL changed = NO;
  for (UIBarButtonItem *item in items) {
    if (item.axisBehavior == UIBarButtonItemAxisBehaviorVerticalPreferred) continue;
    NSString *ident = item.identifier;
    BOOL matched = (ident != nil && [ident hasPrefix:kLilBotDuoVerticalPrefix]);
    if (!matched && item.customView != nil) {
      matched = LilBotViewSubtreeHasVerticalPrefix(item.customView);
    }
    if (matched) {
      item.axisBehavior = UIBarButtonItemAxisBehaviorVerticalPreferred;
      if (item.customView != nil) {
        item.visibilityPriority = UIBarButtonItemVisibilityPriorityHigh;
      }
      changed = YES;
    }
  }
  return changed;
}

static void LilBotSyncNavigationItem(UINavigationItem *navItem) {
  if (navItem == nil) return;
  if (@available(iOS 27.1, *)) {
    NSArray<UIBarButtonItem *> *rightItems = navItem.rightBarButtonItems;
    if (rightItems.count > 0 && LilBotApplyVerticalBehaviorToItems(rightItems)) {
      navItem.rightBarButtonItems = [rightItems copy];
    }
    NSArray<UIBarButtonItem *> *leftItems = navItem.leftBarButtonItems;
    if (leftItems.count > 0 && LilBotApplyVerticalBehaviorToItems(leftItems)) {
      navItem.leftBarButtonItems = [leftItems copy];
    }
  }
}

static void LilBotSyncHeaderSubview(UIView *view) {
  if (view == nil || view.window == nil || !LilBotViewSubtreeHasVerticalPrefix(view)) return;
  UIResponder *responder = view.nextResponder;
  NSUInteger hops = 0;
  while (responder != nil && hops < 32) {
    if ([responder isKindOfClass:UINavigationController.class]) {
      LilBotSyncNavigationItem(((UINavigationController *)responder).topViewController.navigationItem);
      return;
    }
    if ([responder isKindOfClass:UIViewController.class]) {
      LilBotSyncNavigationItem(((UIViewController *)responder).navigationItem);
      return;
    }
    responder = responder.nextResponder;
    hops++;
  }
}

static void LilBotScheduleHeaderSubviewSync(UIView *view) {
  if (view == nil) return;
  LilBotSyncHeaderSubview(view);
  __weak UIView *weakView = view;
  dispatch_async(dispatch_get_main_queue(), ^{
    LilBotSyncHeaderSubview(weakView);
  });
}

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

static void LilBotScreenViewWillLayoutSubviews(UIViewController *self, SEL _cmd) {
  if (sLilBotScreenSuperclass != Nil) {
    struct objc_super superInfo = { .receiver = self, .super_class = sLilBotScreenSuperclass };
    ((void (*)(struct objc_super *, SEL))objc_msgSendSuper)(&superInfo, _cmd);
  }
  LilBotSyncNavigationItem(self.navigationItem);
}

static void LilBotHeaderSubviewDidMoveToWindow(UIView *self, SEL _cmd) {
  if (sLilBotHeaderSubviewWindowSuperclass != Nil) {
    struct objc_super superInfo = { .receiver = self, .super_class = sLilBotHeaderSubviewWindowSuperclass };
    ((void (*)(struct objc_super *, SEL))objc_msgSendSuper)(&superInfo, _cmd);
  }
  if (self.window != nil) {
    LilBotScheduleHeaderSubviewSync(self);
  }
}

static void LilBotHeaderSubviewDidAddSubview(UIView *self, SEL _cmd, UIView *subview) {
  if (sLilBotHeaderSubviewAddSuperclass != Nil) {
    struct objc_super superInfo = { .receiver = self, .super_class = sLilBotHeaderSubviewAddSuperclass };
    ((void (*)(struct objc_super *, SEL, UIView *))objc_msgSendSuper)(&superInfo, _cmd, subview);
  }
  LilBotScheduleHeaderSubviewSync(self);
}

static void LilBotAddMethodIfAbsent(Class cls, Class requiredBase, SEL selector, IMP imp, Class *outSuper) {
  if (cls == Nil || ![cls isSubclassOfClass:requiredBase]) return;
  Method inherited = class_getInstanceMethod(requiredBase, selector);
  const char *types = inherited != NULL ? method_getTypeEncoding(inherited) : NULL;
  Class superClass = class_getSuperclass(cls);
  if (types == NULL || superClass == Nil) return;
  *outSuper = superClass;
  if (!class_addMethod(cls, selector, imp, types)) {
    *outSuper = Nil;
  }
}

__attribute__((constructor))
static void LilBotInstallDuoVerticalBarItems(void) {
  if (@available(iOS 27.1, *)) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
      LilBotAddMethodIfAbsent(
          NSClassFromString(@"RNSBarButtonItem"),
          UIBarButtonItem.class,
          @selector(setIdentifier:),
          (IMP)LilBotBarButtonSetIdentifier,
          &sLilBotBarButtonSuperclass);
      LilBotAddMethodIfAbsent(
          NSClassFromString(@"RNSScreen"),
          UIViewController.class,
          @selector(viewWillLayoutSubviews),
          (IMP)LilBotScreenViewWillLayoutSubviews,
          &sLilBotScreenSuperclass);
      Class headerSubview = NSClassFromString(@"RNSScreenStackHeaderSubview");
      LilBotAddMethodIfAbsent(
          headerSubview,
          UIView.class,
          @selector(didMoveToWindow),
          (IMP)LilBotHeaderSubviewDidMoveToWindow,
          &sLilBotHeaderSubviewWindowSuperclass);
      LilBotAddMethodIfAbsent(
          headerSubview,
          UIView.class,
          @selector(didAddSubview:),
          (IMP)LilBotHeaderSubviewDidAddSubview,
          &sLilBotHeaderSubviewAddSuperclass);
    });
  }
}

#endif
