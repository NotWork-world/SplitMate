import React, {useEffect, useState} from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';
import {DarkTheme, DefaultTheme, NavigationContainer, type LinkingOptions} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator, type BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Activity, Home, Plus, User, Users} from 'lucide-react-native';
import NetInfo from '@react-native-community/netinfo';
import {RefreshCw, WifiOff, X} from 'lucide-react-native';
import {Gradient, Text, haptics, useTheme} from '../design';
import {initialNotificationLink, onNotificationTap} from '../push/push';
import {useAppSelector, syncNow} from '../store';
import {warmUp} from '../api/client';
import {engine} from '../ocr/uniocr';
import {OnboardingScreen} from '../features/auth/Onboarding';
import {SignInScreen, SignUpScreen} from '../features/auth/AuthForms';
import {HomeScreen} from '../features/home/HomeScreen';
import {GroupsScreen} from '../features/groups/GroupsScreen';
import {CreateGroupScreen} from '../features/groups/CreateGroupScreen';
import {GroupDetailScreen} from '../features/groups/GroupDetailScreen';
import {GroupSettingsScreen} from '../features/groups/GroupSettingsScreen';
import {JoinGroupScreen} from '../features/groups/JoinGroupScreen';
import {StartExpenseScreen} from '../features/expenses/StartExpenseScreen';
import {ExpenseEditorScreen} from '../features/expenses/ExpenseEditorScreen';
import {ClaimDishesScreen} from '../features/expenses/ClaimDishesScreen';
import {BillReviewScreen} from '../features/expenses/BillReviewScreen';
import {ExpenseDetailScreen} from '../features/expenses/ExpenseDetailScreen';
import {BalancesScreen} from '../features/balances/BalancesScreen';
import {MemberLedgerScreen} from '../features/balances/MemberLedgerScreen';
import {SettleUpScreen} from '../features/repayments/SettleUpScreen';
import {RepaymentDetailScreen, RepaymentsScreen} from '../features/repayments/RepaymentScreens';
import {ActivityScreen, NotificationsScreen} from '../features/activity/ActivityScreens';
import {EditProfileScreen, PrivacyScreen, ProfileScreen, SettingsScreen} from '../features/profile/ProfileScreens';
import {ReceiptScanScreen} from '../features/receipts/ReceiptScanScreen';
import type {AppParams, AuthParams, TabParams} from './types';

const AuthStack = createNativeStackNavigator<AuthParams>();
const AppStack = createNativeStackNavigator<AppParams>();
const Tabs = createBottomTabNavigator<TabParams>();

const TAB_ICONS = {Home, Groups: Users, Activity, Profile: User};

function TabBar({state, navigation}: BottomTabBarProps) {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const routes = state.routes;
  const renderTab = (index: number) => {
    const route = routes[index];
    const focused = state.index === index;
    const Icon = TAB_ICONS[route.name as keyof typeof TAB_ICONS];
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{selected: focused}}
        accessibilityLabel={route.name}
        onPress={() => {
          haptics.tap();
          const e = navigation.emit({type: 'tabPress', target: route.key, canPreventDefault: true});
          if (!focused && !e.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }}
        style={styles.tab}>
        {focused ? <View style={[styles.indicator, {backgroundColor: colors.highlight}]} /> : null}
        <Icon size={22} color={focused ? colors.accentText : colors.textFaint} strokeWidth={focused ? 2.4 : 2} />
        <Text variant="caption" color={focused ? colors.accentText : colors.textFaint}>
          {route.name}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.bar, {backgroundColor: colors.bgElevated, borderTopColor: colors.border, paddingBottom: insets.bottom + 6}]}>
      {renderTab(0)}
      {renderTab(1)}
      <View style={styles.fabSlot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add an expense"
          testID="tab-add"
          onPress={() => {
            haptics.tap();
            navigation.getParent()?.navigate('StartExpense', {mode: 'itemized'});
          }}
          style={styles.fab}>
          <Gradient colors={colors.gradient} />
          <Plus size={28} color={colors.bg} strokeWidth={2.6} />
        </Pressable>
      </View>
      {renderTab(2)}
      {renderTab(3)}
    </View>
  );
}

const renderTabBar = (props: BottomTabBarProps) => <TabBar {...props} />;

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={{headerShown: false}} tabBar={renderTabBar}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Groups" component={GroupsScreen} />
      <Tabs.Screen name="Activity" component={ActivityScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

// An invite link opened before signing in/up: kept until the app stack mounts, then opened.
let pendingInvite: string | null = null;

/**
 * Offline notice: "turn on internet", closable, with a Reload line that re-checks
 * the connection and refreshes everything when it's back. The app itself stays
 * fully usable on cached data while it shows.
 */
function OfflineBanner() {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const sub = NetInfo.addEventListener(s => {
      const off = !(s.isConnected ?? false) || s.isInternetReachable === false;
      setOffline(off);
      if (!off) {
        setDismissed(false);
      }
    });
    return () => sub();
  }, []);

  if (!offline || dismissed) {
    return null;
  }
  const reload = async () => {
    setChecking(true);
    try {
      const s = await NetInfo.fetch();
      if (s.isConnected && s.isInternetReachable !== false) {
        // Back online: refresh everything without dropping the cache on screen.
        syncNow();
      }
    } finally {
      setChecking(false);
    }
  };
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, {backgroundColor: colors.bgElevated, borderColor: colors.border, marginTop: insets.top + 6}]}>
      <View style={styles.bannerRow}>
        <WifiOff size={18} color={colors.text} />
        <Text variant="body" style={{flex: 1}}>
          Turn on internet — showing your last synced data
        </Text>
        <Pressable accessibilityLabel="Close" hitSlop={10} onPress={() => setDismissed(true)}>
          <X size={18} color={colors.textFaint} />
        </Pressable>
      </View>
      <View style={[styles.bannerRow, {marginTop: 2}]}>
        <Text variant="small" tone="faint" style={{flex: 1}}>
          Reload to check the connection
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload"
          onPress={reload}
          disabled={checking}
          style={({pressed}) => [styles.reload, {backgroundColor: pressed ? colors.surfacePressed : colors.highlight}]}>
          <RefreshCw size={14} color={colors.highlightText} />
          <Text variant="smallStrong" color={colors.highlightText}>
            Reload
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const linking: LinkingOptions<AppParams> = {
  prefixes: ['splitmate://'],
  config: {screens: {JoinGroup: 'join/:code', ExpenseDetail: 'expense/:expenseId', RepaymentDetail: 'repayment/:repaymentId'}},
  getInitialURL: async () => {
    const u = pendingInvite;
    pendingInvite = null;
    return u ?? (await initialNotificationLink()) ?? Linking.getInitialURL();
  },
  // App links, plus tapped phone notifications (they open the bill or payment they're about).
  subscribe: listener => {
    const links = Linking.addEventListener('url', ({url}) => listener(url));
    const taps = onNotificationTap(listener);
    return () => {
      links.remove();
      taps();
    };
  },
};

export function RootNavigator() {
  const status = useAppSelector(s => s.auth.status);
  useEffect(() => {
    if (status !== 'signedIn') {
      return;
    }
    // The free server sleeps: wake it in the background while the cached screens
    // paint, and preload the bill reader so the first scan doesn't wait for it.
    warmUp();
    engine().catch(() => {});
  }, [status]);
  useEffect(() => {
    if (status === 'signedIn') {
      return;
    }
    const keep = (url: string | null | undefined) => {
      if (url && url.startsWith('splitmate://join/')) {
        pendingInvite = url;
      }
    };
    Linking.getInitialURL().then(keep);
    const sub = Linking.addEventListener('url', e => keep(e.url));
    return () => sub.remove();
  }, [status]);
  const {colors, dark} = useTheme();
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {...base.colors, background: colors.bg, card: colors.bgElevated, text: colors.text, border: colors.border, primary: colors.accent},
  };
  const screenOptions = {headerShown: false, animation: 'slide_from_right' as const, contentStyle: {backgroundColor: colors.bg}};

  if (status === 'restoring') {
    return <View style={{flex: 1, backgroundColor: colors.bg}} />;
  }
  return (
    // Keyed by status so signing in remounts it and the pending invite link is read.
    <View style={{flex: 1}}>
      <NavigationContainer key={status} theme={navTheme} linking={status === 'signedIn' ? linking : undefined}>
      {status === 'signedIn' ? (
        <AppStack.Navigator screenOptions={screenOptions}>
          <AppStack.Screen name="Tabs" component={MainTabs} />
          <AppStack.Screen name="CreateGroup" component={CreateGroupScreen} />
          <AppStack.Screen name="GroupDetail" component={GroupDetailScreen} />
          <AppStack.Screen name="GroupSettings" component={GroupSettingsScreen} />
          <AppStack.Screen name="JoinGroup" component={JoinGroupScreen} />
          <AppStack.Screen name="StartExpense" component={StartExpenseScreen} options={{animation: 'slide_from_bottom'}} />
          <AppStack.Screen name="ExpenseEditor" component={ExpenseEditorScreen} />
          <AppStack.Screen name="ClaimDishes" component={ClaimDishesScreen} options={{gestureEnabled: false}} />
          <AppStack.Screen name="BillReview" component={BillReviewScreen} />
          <AppStack.Screen name="ExpenseDetail" component={ExpenseDetailScreen} />
          <AppStack.Screen name="Balances" component={BalancesScreen} />
          <AppStack.Screen name="MemberLedger" component={MemberLedgerScreen} />
          <AppStack.Screen name="SettleUp" component={SettleUpScreen} />
          <AppStack.Screen name="RepaymentDetail" component={RepaymentDetailScreen} />
          <AppStack.Screen name="Repayments" component={RepaymentsScreen} />
          <AppStack.Screen name="Notifications" component={NotificationsScreen} />
          <AppStack.Screen name="Settings" component={SettingsScreen} />
          <AppStack.Screen name="EditProfile" component={EditProfileScreen} />
          <AppStack.Screen name="Privacy" component={PrivacyScreen} />
          <AppStack.Screen name="ReceiptScan" component={ReceiptScanScreen} />
        </AppStack.Navigator>
      ) : (
        <AuthStack.Navigator screenOptions={screenOptions}>
          <AuthStack.Screen name="Onboarding" component={OnboardingScreen} />
          <AuthStack.Screen name="SignIn" component={SignInScreen} />
          <AuthStack.Screen name="SignUp" component={SignUpScreen} />
        </AuthStack.Navigator>
      )}
      </NavigationContainer>
      {status === 'signedIn' ? <OfflineBanner /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 4,
    elevation: 6,
    shadowColor: '#1F3B2D',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    zIndex: 100,
  },
  bannerRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  reload: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999},
  bar: {flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8},
  tab: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 48},
  indicator: {position: 'absolute', top: 2, width: 52, height: 30, borderRadius: 15},
  fabSlot: {width: 76, alignItems: 'center'},
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    marginTop: -26,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#1F3B2D',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 6},
  },
});
