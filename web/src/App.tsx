import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";

import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/lib/auth-store";
import { me } from "@/lib/api/auth";
import { DashboardPage } from "@/pages/DashboardPage";
import { FileDetailPage } from "@/pages/FileDetailPage";
import { LoginPage } from "@/pages/LoginPage";
import { PublicSharePage } from "@/pages/PublicSharePage";
import { RegisterPage } from "@/pages/RegisterPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ThemeBoot() {
  const { theme } = useTheme();
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return null;
}

function SessionBoot() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  useEffect(() => {
    // Don't hydrate the session while viewing a public share — visitors
    // shouldn't be bounced to /login just because they happen to have a stale
    // token in localStorage from a previous workspace.
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/s/")) {
      return;
    }
    if (token && !user) {
      me()
        .then(setUser)
        .catch(() => clear());
    }
  }, [token, user, setUser, clear]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeBoot />
        <SessionBoot />
        <Toaster richColors closeButton position="top-center" />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/s/:token" element={<PublicSharePage />} />

          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            {/* "/file/:id" (singular) reserves "/files/*" for the MinIO
                reverse-proxy in nginx — avoids cross-origin downloads. */}
            <Route path="file/:fileId" element={<FileDetailPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
