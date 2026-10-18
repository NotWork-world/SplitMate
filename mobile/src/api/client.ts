import * as Keychain from 'react-native-keychain';
import {apiUrl} from '../config';
import type {TokenOut} from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get offline() {
    return this.code === 'offline';
  }
}

const KEYCHAIN_SERVICE = 'world.notwork.splitmate.session';
let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

/** Refresh token lives in the Android Keystore-backed keychain; the access token only in memory. */
export async function saveSession(t: TokenOut) {
  accessToken = t.access_token;
  refreshToken = t.refresh_token;
  await Keychain.setGenericPassword('session', t.refresh_token, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadRefreshToken(): Promise<string | null> {
  try {
    const c = await Keychain.getGenericPassword({service: KEYCHAIN_SERVICE});
    refreshToken = c ? c.password : null;
  } catch {
    refreshToken = null;
  }
  return refreshToken;
}

export async function clearSession() {
  accessToken = null;
  refreshToken = null;
  try {
    await Keychain.resetGenericPassword({service: KEYCHAIN_SERVICE});
  } catch {
    // nothing stored
  }
}

export function currentRefreshToken() {
  return refreshToken;
}

/** Unique enough for idempotency keys and client item ids (not a secret). */
export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
  timeoutMs?: number;
}

async function rawFetch(method: string, path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {Accept: 'application/json'};
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.auth !== false && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (opts.idempotencyKey) {
    headers['Idempotency-Key'] = opts.idempotencyKey;
  }
  const controller = new AbortController();
  // Render's free tier can take ~50 s to wake; keep the user informed rather than failing early.
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 70_000);
  try {
    return await fetch(`${apiUrl()}/api${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new ApiError(0, 'timeout', 'The server is taking too long to answer. Check your connection and try again.');
    }
    throw new ApiError(0, 'offline', "Can't reach SplitMate. Check your internet connection.");
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAccess(): Promise<boolean> {
  if (!refreshToken) {
    return false;
  }
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await rawFetch('POST', '/auth/refresh', {body: {refresh_token: refreshToken}, auth: false});
        if (!res.ok) {
          if (res.status === 401) {
            await clearSession();
            onSignedOut?.();
          }
          return false;
        }
        await saveSession((await res.json()) as TokenOut);
        return true;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export async function ensureAccessToken(): Promise<boolean> {
  return accessToken ? true : refreshAccess();
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'http_error',
      err?.message ?? (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed.'),
      err?.details,
    );
  }
  return data as T;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await rawFetch(method, path, opts);
  if (res.status === 401 && opts.auth !== false && refreshToken) {
    if (await refreshAccess()) {
      res = await rawFetch(method, path, opts);
    }
  }
  return parse<T>(res);
}

/** Multipart upload with the same auth/refresh handling as JSON requests. */
export async function uploadFile<T>(path: string, file: {uri: string; type: string; name: string}): Promise<T> {
  const send = async () => {
    const form = new FormData();
    form.append('file', file as any);
    const headers: Record<string, string> = {Accept: 'application/json'};
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    try {
      return await fetch(`${apiUrl()}/api${path}`, {method: 'POST', headers, body: form});
    } catch {
      throw new ApiError(0, 'offline', "Can't reach SplitMate. Check your internet connection.");
    }
  };
  let res = await send();
  if (res.status === 401 && refreshToken && (await refreshAccess())) {
    res = await send();
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', path, {body: body ?? {}, idempotencyKey}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, {body}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, {body}),
  del: <T>(path: string) => request<T>('DELETE', path),
};
