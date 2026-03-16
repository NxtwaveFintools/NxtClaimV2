export type DepartmentUserSummary = {
  id: string;
  email: string;
  fullName: string | null;
  isActive: boolean;
};

export type ActiveDepartmentRouting = {
  id: string;
  name: string;
  isActive: boolean;
  hod: DepartmentUserSummary;
  founder: DepartmentUserSummary;
};

export type DepartmentRepository = {
  getActiveDepartmentsWithApprovers(): Promise<{
    data: ActiveDepartmentRouting[];
    errorMessage: string | null;
  }>;
};

export type DepartmentDomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
};
