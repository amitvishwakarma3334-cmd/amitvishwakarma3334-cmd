const TOKEN_STORAGE_KEY = 'aviator_session_token';

/**
 * Resolves the effective API base URL.
 * Automatically guards against:
 * 1. Accidental 'localhost' or '127.0.0.1' URLs in production deployments.
 * 2. Mixed Content (http:// on https:// sites).
 * 3. Trailing slash issues.
 */
export function getEffectiveApiBaseUrl(): string {
  const envUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!envUrl) return '';

  if (typeof window !== 'undefined') {
    const isLocalhostHost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '0.0.0.0';

    const isLocalhostEnv =
      envUrl.includes('localhost') ||
      envUrl.includes('127.0.0.1') ||
      envUrl.includes('0.0.0.0');

    // If running in production (not on localhost) but envUrl is set to localhost,
    // do NOT try to call localhost from user devices (which causes Network Error).
    // Instead fall back to relative same-origin paths.
    if (!isLocalhostHost && isLocalhostEnv) {
      console.warn(
        `[API] Ignoring local VITE_API_BASE_URL (${envUrl}) in production environment (${window.location.hostname}). Using same-origin API.`
      );
      return '';
    }

    // Upgrade http:// to https:// if the current page is on https:// to avoid mixed-content blocking
    if (window.location.protocol === 'https:' && envUrl.startsWith('http://') && !isLocalhostEnv) {
      return envUrl.replace(/^http:\/\//, 'https://');
    }
  }

  return envUrl;
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export interface ApiResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export async function parseApiResponse<T = any>(res: Response): Promise<ApiResponse<T>> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `Failed to read server response (HTTP ${res.status}).`,
    };
  }

  if (!text || !text.trim()) {
    return {
      ok: res.ok,
      status: res.status,
      data: null,
      error: res.ok ? undefined : `Server returned empty response (HTTP ${res.status}).`,
    };
  }

  try {
    const json = JSON.parse(text) as T & { error?: string };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: json,
        error: json.error || `Request failed with status code ${res.status}.`,
      };
    }
    return {
      ok: true,
      status: res.status,
      data: json,
    };
  } catch {
    // Non-JSON response (e.g. 500 HTML page, 502 Bad Gateway, 404 HTML, or Cloudflare error)
    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        data: null,
        error: 'Authentication endpoint not found (HTTP 404). Please verify backend routes.',
      };
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `Authentication server unavailable (HTTP ${res.status}). Please try again in a moment.`,
      };
    }
    if (res.status === 500) {
      return {
        ok: false,
        status: 500,
        data: null,
        error: 'Internal authentication server or database error (HTTP 500). Please check server logs.',
      };
    }
    const cleanExcerpt = text.slice(0, 80).replace(/<[^>]*>/g, '').trim();
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `Server error (HTTP ${res.status}): ${cleanExcerpt || 'Invalid response format'}`,
    };
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const baseUrl = getEffectiveApiBaseUrl();
  const url = baseUrl && input.startsWith('/') ? `${baseUrl}${input}` : input;
  return fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
}

