import {createApi, BaseQueryFn} from '@reduxjs/toolkit/query/react';
import type {BillResult} from '../money/types';
import {ApiError, request} from './client';
import type {
  PublicUser,
  ActivityItem,
  Expense,
  ExpensePayload,
  ExpenseSummary,
  Group,
  GroupBalances,
  Health,
  InvitePreview,
  LedgerLine,
  Member,
  MyBalances,
  Page,
  Repayment,
  RepaymentActionName,
  Summary,
  User,
} from './types';

type Args = {url: string; method?: string; body?: unknown; idempotencyKey?: string};
export type QueryError = {status: number; code: string; message: string; details?: any};

const baseQuery: BaseQueryFn<Args | string, unknown, QueryError> = async arg => {
  const a = typeof arg === 'string' ? {url: arg} : arg;
  try {
    const data = await request(a.method ?? 'GET', a.url, {body: a.body, idempotencyKey: a.idempotencyKey});
    // 204 No Content resolves to undefined, which RTK Query treats as "no result".
    return {data: data ?? null};
  } catch (e) {
    if (e instanceof ApiError) {
      return {error: {status: e.status, code: e.code, message: e.message, details: e.details}};
    }
    return {error: {status: 0, code: 'unknown', message: 'Something went wrong. Please try again.'}};
  }
};

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

// Everything that can change balances invalidates these together.
const MONEY_TAGS = ['Summary', 'Balances', 'Groups', 'Expenses', 'Activity', 'Repayments', 'Notifications'] as const;

export const splitApi = createApi({
  reducerPath: 'splitApi',
  baseQuery,
  tagTypes: ['Me', 'Summary', 'Groups', 'Group', 'Expenses', 'Expense', 'Balances', 'Repayments', 'Activity', 'Notifications'],
  endpoints: b => ({
    health: b.query<Health, void>({query: () => '/health'}),
    me: b.query<User, void>({query: () => '/me', providesTags: ['Me']}),
    updateMe: b.mutation<User, Partial<Pick<User, 'display_name' | 'username' | 'upi_id' | 'upi_qr' | 'default_currency' | 'avatar_hue' | 'phone'>> & {preferences?: Record<string, boolean>}>({
      query: body => ({url: '/me', method: 'PATCH', body}),
      invalidatesTags: ['Me', 'Groups', 'Summary'],
    }),
    changePassword: b.mutation<void, {current_password?: string; new_password: string}>({
      query: body => ({url: '/me/password', method: 'POST', body}),
    }),
    summary: b.query<Summary, void>({query: () => '/me/summary', providesTags: ['Summary']}),
    myBalances: b.query<MyBalances, void>({query: () => '/me/balances', providesTags: ['Balances']}),
    spending: b.query<{currency: string; months: Array<{month: string; amount_minor: number}>}, number>({
      query: months => `/me/spending?months=${months}`,
      providesTags: ['Summary'],
    }),
    exportData: b.mutation<any, void>({query: () => ({url: '/me/export'})}),
    deleteAccount: b.mutation<void, {confirm: 'DELETE'; password?: string}>({
      query: body => ({url: '/me/delete', method: 'POST', body}),
    }),

    groups: b.query<Group[], {includePersonal?: boolean} | void>({
      query: a => `/groups${qs({include_personal: a && a.includePersonal ? 'true' : undefined})}`,
      providesTags: ['Groups'],
    }),
    group: b.query<Group, string>({query: id => `/groups/${id}`, providesTags: (_r, _e, id) => [{type: 'Group', id}, 'Groups']}),
    createGroup: b.mutation<Group, {name: string; type: string; emoji?: string | null; currency: string; start_date?: string | null; end_date?: string | null; members: Array<{display_name: string}>}>({
      query: body => ({url: '/groups', method: 'POST', body}),
      invalidatesTags: ['Groups', 'Summary'],
    }),
    groupWithPeople: b.mutation<Group, {name: string; currency: string; members: Array<{username?: string; display_name?: string}>}>({
      query: body => ({url: '/groups/with-people', method: 'POST', body: {type: 'friends', ...body}}),
      invalidatesTags: ['Groups', 'Summary'],
    }),
    myPeople: b.query<PublicUser[], void>({query: () => '/me/people', providesTags: ['Groups']}),
    updateGroup: b.mutation<Group, {id: string; body: Record<string, unknown>}>({
      query: ({id, body}) => ({url: `/groups/${id}`, method: 'PATCH', body}),
      invalidatesTags: ['Groups', 'Group', 'Summary'],
    }),
    addMember: b.mutation<Member, {groupId: string; display_name?: string; username?: string}>({
      query: ({groupId, ...body}) => ({url: `/groups/${groupId}/members`, method: 'POST', body}),
      invalidatesTags: ['Groups', 'Group', 'Activity'],
    }),
    userByUsername: b.query<PublicUser, string>({
      query: u => `/users/by-username/${encodeURIComponent(u.trim().replace(/^@/, '').toLowerCase())}`,
    }),
    updateMember: b.mutation<Member, {groupId: string; memberId: string; body: {display_name?: string; role?: string}}>({
      query: ({groupId, memberId, body}) => ({url: `/groups/${groupId}/members/${memberId}`, method: 'PATCH', body}),
      invalidatesTags: ['Groups', 'Group'],
    }),
    removeMember: b.mutation<void, {groupId: string; memberId: string}>({
      query: ({groupId, memberId}) => ({url: `/groups/${groupId}/members/${memberId}`, method: 'DELETE'}),
      invalidatesTags: ['Groups', 'Group', 'Summary', 'Activity'],
    }),
    createInvite: b.mutation<{code: string; expires_at: string; link: string; share_text: string},{groupId: string; memberId?: string}>({
      query: ({groupId, memberId}) => ({url: `/groups/${groupId}/invites`, method: 'POST', body: {member_id: memberId ?? null}}),
    }),
    invitePreview: b.query<InvitePreview, string>({query: code => `/invites/${encodeURIComponent(code)}`}),
    acceptInvite: b.mutation<Group, {code: string; memberId?: string}>({
      query: ({code, memberId}) => ({url: `/invites/${encodeURIComponent(code)}/accept`, method: 'POST', body: {member_id: memberId ?? null}}),
      invalidatesTags: [...MONEY_TAGS],
    }),
    groupBalances: b.query<GroupBalances, string>({
      query: id => `/groups/${id}/balances`,
      providesTags: ['Balances'],
    }),
    memberLedger: b.query<Page<LedgerLine>, {groupId: string; memberId: string}>({
      query: ({groupId, memberId}) => `/groups/${groupId}/members/${memberId}/ledger`,
      providesTags: ['Balances'],
    }),

    expenses: b.query<Page<ExpenseSummary>, {groupId?: string; status?: string; category?: string; q?: string; offset?: number}>({
      query: ({groupId, ...p}) => `${groupId ? `/groups/${groupId}` : ''}/expenses${qs({...p, limit: 30})}`,
      providesTags: ['Expenses'],
      serializeQueryArgs: ({queryArgs}) => {
        // Every page of the same list shares one cache entry (pages are merged below).
        return {groupId: queryArgs.groupId, status: queryArgs.status, category: queryArgs.category, q: queryArgs.q};
      },
      merge: (cache, incoming, {arg}) => {
        if (!arg.offset) {
          return incoming;
        }
        const seen = new Set(cache.items.map(i => i.id));
        return {items: [...cache.items, ...incoming.items.filter(i => !seen.has(i.id))], next_offset: incoming.next_offset};
      },
      forceRefetch: ({currentArg, previousArg}) => currentArg?.offset !== previousArg?.offset,
    }),
    expense: b.query<Expense, string>({query: id => `/expenses/${id}`, providesTags: (_r, _e, id) => [{type: 'Expense', id}]}),
    previewExpense: b.mutation<BillResult & {resolved_payers: Record<string, number>}, {groupId: string; body: ExpensePayload}>({
      query: ({groupId, body}) => ({url: `/groups/${groupId}/expenses/preview`, method: 'POST', body}),
    }),
    createExpense: b.mutation<Expense, {groupId: string; body: ExpensePayload; finalize?: boolean; clientTotal?: number; idempotencyKey: string}>({
      query: ({groupId, body, finalize, clientTotal, idempotencyKey}) => ({
        url: `/groups/${groupId}/expenses${finalize ? `?finalize=true${clientTotal !== undefined ? `&client_total_minor=${clientTotal}` : ''}` : ''}`,
        method: 'POST',
        body,
        idempotencyKey,
      }),
      invalidatesTags: [...MONEY_TAGS],
    }),
    updateExpense: b.mutation<Expense, {id: string; body: ExpensePayload & {expected_version: number}}>({
      query: ({id, body}) => ({url: `/expenses/${id}`, method: 'PUT', body}),
      invalidatesTags: (_r, _e, {id}) => [{type: 'Expense', id}, ...MONEY_TAGS],
    }),
    finalizeExpense: b.mutation<Expense, {id: string; expected_version: number; client_total_minor: number | null; idempotencyKey: string}>({
      query: ({id, idempotencyKey, ...body}) => ({url: `/expenses/${id}/finalize`, method: 'POST', body, idempotencyKey}),
      invalidatesTags: (_r, _e, {id}) => [{type: 'Expense', id}, ...MONEY_TAGS],
    }),
    cancelExpense: b.mutation<Expense | undefined, {id: string; expected_version: number; reason?: string}>({
      query: ({id, ...body}) => ({url: `/expenses/${id}/cancel`, method: 'POST', body}),
      invalidatesTags: (_r, _e, {id}) => [{type: 'Expense', id}, ...MONEY_TAGS],
    }),

    repayments: b.query<Page<Repayment>, {groupId?: string; status?: string} | void>({
      query: a => `/repayments${qs({group_id: a?.groupId, status: a?.status})}`,
      providesTags: ['Repayments'],
    }),
    repayment: b.query<Repayment, string>({query: id => `/repayments/${id}`, providesTags: ['Repayments']}),
    createRepayment: b.mutation<
      Repayment,
      {group_id: string; currency: string; amount_minor: number; mode: 'request' | 'record'; other_member_id: string; method: string; note?: string | null; reference?: string | null; idempotencyKey: string}
    >({
      query: ({idempotencyKey, ...body}) => ({url: '/repayments', method: 'POST', body, idempotencyKey}),
      invalidatesTags: [...MONEY_TAGS],
    }),
    repaymentAction: b.mutation<Repayment, {id: string; action: RepaymentActionName; note?: string | null; reference?: string | null; method?: string; idempotencyKey: string}>({
      query: ({id, idempotencyKey, ...body}) => ({url: `/repayments/${id}/actions`, method: 'POST', body, idempotencyKey}),
      invalidatesTags: [...MONEY_TAGS],
    }),
    remind: b.mutation<{amount_minor: number; currency: string}, {group_id: string; other_member_id: string; currency: string}>({
      query: body => ({url: '/repayments/remind', method: 'POST', body}),
      invalidatesTags: [...MONEY_TAGS],
    }),

    activity: b.query<Page<ActivityItem>, {groupId?: string} | void>({
      query: a => `/activity${qs({group_id: a?.groupId, limit: 50})}`,
      providesTags: ['Activity'],
    }),
    notifications: b.query<Page<ActivityItem>, void>({query: () => '/notifications?limit=50', providesTags: ['Notifications']}),
    markNotificationsRead: b.mutation<void, {ids?: string[]}>({
      query: body => ({url: '/notifications/read', method: 'POST', body}),
      invalidatesTags: ['Notifications', 'Summary'],
    }),
  }),
});

export const {
  useHealthQuery,
  useMeQuery,
  useUpdateMeMutation,
  useChangePasswordMutation,
  useSummaryQuery,
  useMyBalancesQuery,
  useSpendingQuery,
  useExportDataMutation,
  useDeleteAccountMutation,
  useGroupsQuery,
  useGroupQuery,
  useCreateGroupMutation,
  useUpdateGroupMutation,
  useAddMemberMutation,
  useGroupWithPeopleMutation,
  useMyPeopleQuery,
  useLazyUserByUsernameQuery,
  useUpdateMemberMutation,
  useRemoveMemberMutation,
  useCreateInviteMutation,
  useInvitePreviewQuery,
  useAcceptInviteMutation,
  useGroupBalancesQuery,
  useMemberLedgerQuery,
  useExpensesQuery,
  useExpenseQuery,
  usePreviewExpenseMutation,
  useCreateExpenseMutation,
  useUpdateExpenseMutation,
  useFinalizeExpenseMutation,
  useCancelExpenseMutation,
  useRepaymentsQuery,
  useRepaymentQuery,
  useCreateRepaymentMutation,
  useRepaymentActionMutation,
  useRemindMutation,
  useActivityQuery,
  useNotificationsQuery,
  useMarkNotificationsReadMutation,
} = splitApi;

export function errorMessage(e: unknown): string {
  const err = e as Partial<QueryError> | undefined;
  return err?.message ?? 'Something went wrong. Please try again.';
}
