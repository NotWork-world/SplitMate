import type {NavigatorScreenParams} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

export type TabParams = {
  Home: undefined;
  Groups: undefined;
  Activity: undefined;
  Profile: undefined;
};

export type AuthParams = {
  Onboarding: undefined;
  SignIn: undefined;
  SignUp: undefined;
};

export type AppParams = {
  Tabs: NavigatorScreenParams<TabParams>;
  CreateGroup: undefined;
  GroupDetail: {groupId: string};
  GroupSettings: {groupId: string};
  JoinGroup: {code?: string};
  StartExpense: {groupId?: string; mode?: 'itemized' | 'simple'};
  ExpenseEditor: {localId: string};
  ClaimDishes: {localId: string; startAt?: string};
  BillReview: {localId: string};
  ExpenseDetail: {expenseId: string};
  Balances: undefined;
  MemberLedger: {groupId: string; memberId: string; name: string};
  SettleUp: {groupId: string; memberId: string; currency: string; amount: number; mode: 'request' | 'record'};
  RepaymentDetail: {repaymentId: string};
  Repayments: {groupId?: string};
  Notifications: undefined;
  Settings: undefined;
  EditProfile: undefined;
  Privacy: undefined;
  ReceiptScan: {localId: string};
};

export type AppScreen<T extends keyof AppParams> = NativeStackScreenProps<AppParams, T>;
export type AuthScreen<T extends keyof AuthParams> = NativeStackScreenProps<AuthParams, T>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends AppParams {}
  }
}
