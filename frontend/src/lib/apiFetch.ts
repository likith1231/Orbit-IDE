import { getToken, clearAuth } from '../auth';

// Base URL of the backend, e.g. "https://api.example.com". Empty means same origin.
export const API_URL: string = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/+$/, '');

// ws(s):// version of API_URL, for raw websocket endpoints (Yjs).
export const WS_URL: string = (() => {
  const base = API_URL || window.location.origin;
  return base.replace(/^http/, 'ws');
})();

// fetch() wrapper: prefixes relative paths with API_URL, adds the auth token and a JSON
// content type for string bodies, and sends the user back to login when the session expires.
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const options: RequestInit = { ...(init || {}) };
  const headers = new Headers(options.headers || {});
  headers.set('ngrok-skip-browser-warning', 'true');
  const token = getToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  if (typeof options.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  options.headers = headers;

  const url = typeof input === 'string' && input.startsWith('/') ? `${API_URL}${input}` : input;
  const res = await fetch(url, options);
  if (res.status === 401 && token && !String(url).includes('/api/auth/')) {
    clearAuth();
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login');
  }
  return res;
};

// Full URL for a backend-relative path such as an app preview ("/preview/<token>/").
export const backendUrl = (path: string) => `${API_URL}${path}`;
