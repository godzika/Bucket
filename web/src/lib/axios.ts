import axios, { AxiosError } from "axios";

import { useAuthStore } from "./auth-store";

// When VITE_API_URL is set at build time, use it verbatim. Otherwise resolve
// to the same origin the SPA was served from (nginx proxies /api/ to the api
// container). Using window.location.origin explicitly — rather than relying on
// axios' relative-URL handling — sidesteps a class of mobile-browser bugs
// (iOS Safari/Chrome) where relative XHR URLs sometimes silently fail.
function resolveBaseURL(): string {
  const fromEnv = import.meta.env.VITE_API_URL;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

const baseURL = resolveBaseURL();

export const api = axios.create({
  baseURL,
  // Folder uploads enqueue many metadata requests; allow slow responses under load.
  timeout: 120_000,
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

// Routes that don't require auth — never redirect to /login from these even
// when an expired token in localStorage causes a 401.
const PUBLIC_PATH_PREFIXES = ["/login", "/register", "/s/"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const { token, clear } = useAuthStore.getState();
      // Only clear if we had a token — otherwise it's a fresh session 401.
      if (token) {
        clear();
        if (typeof window !== "undefined" && !isPublicPath(window.location.pathname)) {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.replace(`/login?next=${next}`);
        }
      }
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: unknown } | undefined;
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail) && data.detail[0]?.msg) {
      return String(data.detail[0].msg);
    }
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
