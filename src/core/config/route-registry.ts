export const DASHBOARD_MY_CLAIMS = "/dashboard/my-claims";

export const ROUTES = {
  home: "/",
  dashboard: "/dashboard",
  claims: {
    list: "/claims",
    dashboardList: "/dashboard/claims",
    myClaims: DASHBOARD_MY_CLAIMS,
    detail: (id: string) => `/dashboard/claims/${id}`,
    new: "/claims/new",
  },
  login: "/auth/login",
  authApi: {
    callback: "/api/auth/callback",
    emailLogin: "/api/auth/email-login",
    logout: "/api/auth/logout",
    session: "/api/auth/session",
  },
  dashboardApi: {
    entry: "/api/dashboard/entry",
  },
  exportApi: {
    claims: "/api/export/claims",
  },
  admin: {
    settings: "/dashboard/admin/settings",
  },
} as const;
