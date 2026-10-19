import React, {useEffect} from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';
import {DarkTheme, DefaultTheme, NavigationContainer, type LinkingOptions} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator, type BottomTabBarProps} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Activity, Home, Plus, User, Users} from 'lucide-react-native';
import {Gradient, Text, haptics, useTheme} from '../design';
import {initialNotificationLink, onNotificationTap} from '../push/push';
import {useAppSelector} from '../store';
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
  );
}

const styles = StyleSheet.create({
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
