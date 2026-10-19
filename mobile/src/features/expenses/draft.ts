import AsyncStorage from '@react-native-async-storage/async-storage';
import {createSlice, PayloadAction} from '@reduxjs/toolkit';
import {newId} from '../../api/client';
import type {ChargePayload, DiscountPayload, Expense, ExpensePayload, ItemPayload} from '../../api/types';
import {computeBill} from '../../money/engine';
import type {BillInput, BillResult} from '../../money/types';

/** A local working copy. Nothing here affects balances until the server finalises it. */
export interface Draft {
  localId: string;
  groupId: string;
  serverId: string | null; // set once saved to the server
  serverVersion: number | null;
  serverStatus: 'draft' | 'finalized' | null;
  idempotencyKey: string; // reused for retries of the same create/finalise
  payload: ExpensePayload;
  updatedAt: number;
}

const STORAGE_KEY = 'splitmate.drafts.v1';

export function todayIso(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function emptyPayload(currency: string, payerId: string | null, itemized = true): ExpensePayload {
  return {
    title: '',
    category: itemized ? 'food' : 'other',
    notes: null,
    expense_date: todayIso(),
    currency,
    split_kind: itemized ? 'itemized' : 'equal',
    items: [],
    discounts: [],
    charges: [],
    reported_taxes: [],
    rounding: {mode: 'none', amount_minor: 0},
    receipt_total_minor: null,
    payers: payerId ? [{member_id: payerId, amount_minor: null}] : [],
    receipt_id: null,
  };
}

export function newItem(partial: Partial<ItemPayload> = {}): ItemPayload {
  return {
    client_id: newId('it_'),
    name: '',
    quantity_milli: 1000,
    unit_price_minor: 0,
    discount: null,
    tax_rate_bp: 0,
    tax_inclusive: false,
    tax_scheme: 'gst',
    split_mode: 'equal',
    consumers: [],
    review_state: 'pending',
    source: 'manual',
    ocr_confidence: null,
    ...partial,
  };
}

export function newDiscount(partial: Partial<DiscountPayload> = {}): DiscountPayload {
  return {
    client_id: newId('d_'),
    label: 'Discount',
    kind: 'fixed',
    value: 0,
    stage: 'pre_tax',
    allocation: 'proportional',
    item_client_ids: null,
    is_coupon: false,
    ...partial,
  };
}

export function newCharge(partial: Partial<ChargePayload> = {}): ChargePayload {
  return {
    client_id: newId('c_'),
    label: 'Service charge',
    type: 'service',
    kind: 'percent',
    value: 0,
    tax_rate_bp: 0,
    tax_scheme: 'gst',
    allocation: 'proportional',
    ...partial,
  };
}

export function payloadFromExpense(e: Expense): ExpensePayload {
  return {
    title: e.title,
    category: e.category,
    notes: e.notes,
    expense_date: e.expense_date,
    currency: e.currency,
    split_kind: e.split_kind,
    items: e.items,
    discounts: e.discounts,
    charges: e.charges,
    reported_taxes: e.reported_taxes,
    rounding: e.rounding,
    receipt_total_minor: e.receipt_total_minor,
    payers: e.payers,
    receipt_id: e.receipt_id,
  };
}

/** Same translation the server does (services/expenses.py bill_input_from_payload). */
export function toBillInput(p: ExpensePayload): BillInput {
  return {
    currency: p.currency,
    items: p.items.map(it => ({
      id: it.client_id,
      name: it.name,
      quantity_milli: it.quantity_milli,
      unit_price_minor: it.unit_price_minor,
      discount: it.discount,
      tax_rate_bp: it.tax_rate_bp,
      tax_inclusive: it.tax_inclusive,
      tax_scheme: it.tax_scheme,
      split_mode: it.split_mode,
      consumers: it.consumers.map(c => ({member_id: c.member_id, value: c.value})),
    })),
    discounts: p.discounts.map(d => ({
      id: d.client_id,
      label: d.label,
      kind: d.kind,
      value: d.value,
      stage: d.stage,
      allocation: d.allocation,
      item_ids: d.item_client_ids,
      is_coupon: d.is_coupon,
    })),
    charges: p.charges.map(c => ({
      id: c.client_id,
      label: c.label,
      type: c.type,
      kind: c.kind,
      value: c.value,
      tax_rate_bp: c.tax_rate_bp,
      tax_scheme: c.tax_scheme,
      allocation: c.allocation,
    })),
    reported_taxes: p.reported_taxes,
    rounding: p.rounding,
    receipt_total_minor: p.receipt_total_minor,
  };
}

export interface Preview {
  result: BillResult;
  paid: Record<string, number>;
  payerIssue: string | null;
}

/** Local preview + payer check, mirroring what the server will enforce. */
export function preview(p: ExpensePayload): Preview {
  const result = computeBill(toBillInput(p));
  let paid: Record<string, number> = {};
  let payerIssue: string | null = null;
  if (!p.payers.length) {
    payerIssue = 'Choose who paid.';
  } else if (p.payers.length === 1 && p.payers[0].amount_minor === null) {
    paid = {[p.payers[0].member_id]: result.total};
  } else if (p.payers.some(x => x.amount_minor === null)) {
    payerIssue = 'With more than one payer, enter how much each person paid.';
  } else {
    const s = p.payers.reduce((a, x) => a + (x.amount_minor ?? 0), 0);
    if (s !== result.total) {
      payerIssue = "What the payers paid doesn't add up to the bill total.";
    }
    paid = Object.fromEntries(p.payers.map(x => [x.member_id, x.amount_minor ?? 0]));
  }
  return {result, paid, payerIssue};
}

export function canFinalize(pv: Preview): boolean {
  return pv.result.can_finalize && !pv.payerIssue && pv.result.total > 0;
}

// ------------------------------------------------------------------ slice

interface DraftsState {
  byId: Record<string, Draft>;
  loaded: boolean;
}

const slice = createSlice({
  name: 'drafts',
  initialState: {byId: {}, loaded: false} as DraftsState,
  reducers: {
    loaded(state, action: PayloadAction<Record<string, Draft>>) {
      state.byId = {...action.payload, ...state.byId};
      state.loaded = true;
    },
    upsert(state, action: PayloadAction<Draft>) {
      state.byId[action.payload.localId] = action.payload;
    },
    patch(state, action: PayloadAction<{localId: string; payload: Partial<ExpensePayload>}>) {
      const d = state.byId[action.payload.localId];
      if (d) {
        d.payload = {...d.payload, ...action.payload.payload};
        d.updatedAt = Date.now();
      }
    },
    updateItem(state, action: PayloadAction<{localId: string; clientId: string; changes: Partial<ItemPayload>}>) {
      const d = state.byId[action.payload.localId];
      const it = d?.payload.items.find(i => i.client_id === action.payload.clientId);
      if (d && it) {
        Object.assign(it, action.payload.changes);
        d.updatedAt = Date.now();
      }
    },
    synced(state, action: PayloadAction<{localId: string; serverId: string; version: number; status: 'draft' | 'finalized'}>) {
      const d = state.byId[action.payload.localId];
      if (d) {
        d.serverId = action.payload.serverId;
        d.serverVersion = action.payload.version;
        d.serverStatus = action.payload.status;
        d.idempotencyKey = newId('idem_');
      }
    },
    remove(state, action: PayloadAction<string>) {
      delete state.byId[action.payload];
    },
  },
});

export const draftActions = slice.actions;
export const draftsReducer = slice.reducer;

export async function loadDrafts(): Promise<Record<string, Draft>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Draft>) : {};
  } catch {
    return {};
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function persistDrafts(byId: Record<string, Draft>) {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(byId)).catch(() => {});
  }, 300);
}

export function createDraft(groupId: string, payload: ExpensePayload, server?: Expense): Draft {
  return {
    localId: newId('draft_'),
    groupId,
    serverId: server?.id ?? null,
    serverVersion: server?.version ?? null,
    serverStatus: server ? (server.status === 'finalized' ? 'finalized' : 'draft') : null,
    idempotencyKey: newId('idem_'),
    payload,
    updatedAt: Date.now(),
  };
}

const RECEIPT_ADJUST = 'receipt-adjust';

/**
 * Make the bill match the total printed on the receipt. Restaurants round, leave packed
 * items untaxed or simply add up wrong; the gap becomes one labelled line shared by
 * everyone in proportion to what they had (a fee if the receipt is higher, a discount if
 * it's lower), so nobody's dish is changed. Returns null when it already matches.
 */
export function matchReceiptPatch(p: ExpensePayload): Pick<ExpensePayload, 'charges' | 'discounts'> | null {
  if (p.receipt_total_minor === null || p.receipt_total_minor === undefined) {
    return null;
  }
  const base = {
    ...p,
    charges: p.charges.filter(c => c.client_id !== RECEIPT_ADJUST),
    discounts: p.discounts.filter(d => d.client_id !== RECEIPT_ADJUST),
  };
  const diff = p.receipt_total_minor - preview(base).result.total;
  const label = 'Receipt difference (rounding, untaxed items)';
  if (diff > 0) {
    const charge: ChargePayload = {
      client_id: RECEIPT_ADJUST, label, type: 'adjustment', kind: 'fixed', value: diff,
      tax_rate_bp: 0, tax_scheme: 'gst', allocation: 'proportional',
    };
    return {charges: [...base.charges, charge], discounts: base.discounts};
  }
  if (diff < 0) {
    const discount: DiscountPayload = {
      client_id: RECEIPT_ADJUST, label, kind: 'fixed', value: -diff, stage: 'post_tax',
      allocation: 'proportional', item_client_ids: null, is_coupon: false,
    };
    return {charges: base.charges, discounts: [...base.discounts, discount]};
  }
  return base.charges.length !== p.charges.length || base.discounts.length !== p.discounts.length
    ? {charges: base.charges, discounts: base.discounts}
    : null;
}
