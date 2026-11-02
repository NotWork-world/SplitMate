import type {BillResult, ChargeType, Kind, SplitMode, TaxScheme} from '../money/types';

export interface User {
  id: string;
  email: string | null;
  display_name: string;
  username: string | null;
  avatar_hue: number;
  upi_id: string | null;
  upi_qr?: string | null;
  phone?: string | null;
  default_currency: string;
  preferences: Record<string, boolean>;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
}

export interface TokenOut {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

export interface Member {
  id: string;
  display_name: string;
  user_id: string | null;
  role: 'owner' | 'admin' | 'member';
  status: string;
  is_me: boolean;
  is_registered: boolean;
  avatar_hue: number;
  upi_id?: string | null;
  username?: string | null;
  upi_qr?: string | null;
  phone?: string | null;
}

export interface PublicUser {
  username: string;
  display_name: string;
  avatar_hue: number;
}

export interface BalanceLine {
  currency: string;
  amount_minor: number;
}

export interface Group {
  id: string;
  name: string;
  type: 'trip' | 'home' | 'couple' | 'friends' | 'other' | 'personal';
  emoji: string | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  archived: boolean;
  created_at: string;
  my_member_id: string;
  my_role: string;
  members: Member[];
  my_balances: BalanceLine[];
  expense_count: number;
}

export interface ItemPayload {
  client_id: string;
  name: string;
  quantity_milli: number;
  unit_price_minor: number;
  discount: {kind: Kind; value: number} | null;
  tax_rate_bp: number;
  tax_inclusive: boolean;
  tax_scheme: TaxScheme;
  split_mode: SplitMode;
  consumers: Array<{member_id: string; value: number}>;
  review_state: 'pending' | 'claimed' | 'skipped';
  source: 'manual' | 'receipt';
  ocr_confidence: number | null;
}

export interface DiscountPayload {
  client_id: string;
  label: string;
  kind: Kind;
  value: number;
  stage: 'pre_tax' | 'post_tax';
  allocation: 'proportional' | 'equal';
  item_client_ids: string[] | null;
  is_coupon: boolean;
}

export interface ChargePayload {
  client_id: string;
  label: string;
  type: ChargeType;
  kind: Kind;
  value: number;
  tax_rate_bp: number;
  tax_scheme: TaxScheme;
  allocation: 'proportional' | 'equal';
}

export interface ReportedTaxPayload {
  component: 'GST' | 'CGST' | 'SGST' | 'IGST';
  rate_bp: number;
  amount_minor: number;
}

export type SplitKind = 'itemized' | 'equal' | 'exact' | 'percent' | 'shares';

export interface ExpensePayload {
  title: string;
  category: string;
  notes: string | null;
  expense_date: string;
  currency: string;
  split_kind: SplitKind;
  items: ItemPayload[];
  discounts: DiscountPayload[];
  charges: ChargePayload[];
  reported_taxes: ReportedTaxPayload[];
  rounding: {mode: 'none' | 'explicit' | 'nearest_unit'; amount_minor: number};
  receipt_total_minor: number | null;
  payers: Array<{member_id: string; amount_minor: number | null}>;
  receipt_id: string | null;
}

export interface Expense extends ExpensePayload {
  id: string;
  group_id: string;
  group_name: string;
  group_type: string;
  status: 'draft' | 'finalized' | 'cancelled';
  version: number;
  finalized_version: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
  cancelled_at: string | null;
  resolved_payers: Record<string, number>;
  calculation: BillResult;
  my_member_id: string;
  my_share_minor: number;
  my_paid_minor: number;
  can_edit: boolean;
  can_cancel: boolean;
  versions: Array<{version: number; total_minor: number; created_at: string; actor: string}>;
}

export interface ExpenseSummary {
  id: string;
  group_id: string;
  group_name: string;
  title: string;
  category: string;
  status: string;
  expense_date: string;
  currency: string;
  total_minor: number | null;
  paid_by: string[];
  my_share_minor: number | null;
  my_net_minor: number | null;
  item_count: number;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  next_offset: number | null;
}

export type RepaymentStatus =
  | 'REQUESTED'
  | 'MARKED_SENT'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'REVERTED';

export type RepaymentActionName = 'mark_sent' | 'confirm' | 'dispute' | 'reject' | 'cancel' | 'resubmit' | 'revert';

export interface Repayment {
  id: string;
  group_id: string;
  group_name: string;
  currency: string;
  amount_minor: number;
  status: RepaymentStatus;
  method: 'cash' | 'upi' | 'bank' | 'other';
  note: string | null;
  reference: string | null;
  debtor: Member;
  creditor: Member;
  i_am: 'debtor' | 'creditor' | 'other';
  allowed_actions: RepaymentActionName[];
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  events: Array<{action: string; from_status: string | null; to_status: string; note: string | null; created_at: string}>;
}

export interface Summary {
  owed_to_me: BalanceLine[];
  i_owe: BalanceLine[];
  recent_expenses: ExpenseSummary[];
  needs_my_action: Repayment[];
  drafts: ExpenseSummary[];
  unread_notifications: number;
  personal_group_id: string | null;
  group_count: number;
}

export interface GroupBalances {
  group_id: string;
  balances: Array<{
    currency: string;
    members: Array<{member: Member; net_minor: number}>;
    debts: Array<{from: Member; to: Member; amount_minor: number}>;
    suggestions: Array<{from: Member; to: Member; amount_minor: number}>;
    total_check_minor: number;
  }>;
}

export interface MyBalances {
  groups: Array<{
    group_id: string;
    group_name: string;
    group_emoji: string | null;
    currency: string;
    my_member_id: string;
    net_minor: number;
    people: Array<{member: Member; amount_minor: number}>;
  }>;
}

export interface ActivityItem {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string | null;
  group_id: string | null;
  group_name: string;
  actor: string;
  data: Record<string, any>;
  created_at: string;
  notification_id?: string;
  read?: boolean;
}

export interface LedgerLine {
  id: string;
  kind: 'expense' | 'reversal' | 'repayment';
  currency: string;
  created_at: string;
  expense_id: string | null;
  expense_version: number | null;
  expense_title: string | null;
  repayment_id: string | null;
  effect_minor: number;
}

export interface Health {
  ok: boolean;
  version: string;
  features: {google_sign_in: boolean; google_web_client_id: string | null; receipt_storage: string; ocr?: string};
}

export interface InvitePreview {
  group_name: string;
  group_emoji: string | null;
  member_count: number;
  claimable_members: Member[];
}
