import type {
  ActiveDepartmentRouting,
  DepartmentDomainLogger,
  DepartmentRepository,
} from "@/core/domain/departments/contracts";

type GetActiveDepartmentsServiceDependencies = {
  repository: DepartmentRepository;
  logger: DepartmentDomainLogger;
};

export class GetActiveDepartmentsService {
  private readonly repository: DepartmentRepository;
  private readonly logger: DepartmentDomainLogger;

  constructor(deps: GetActiveDepartmentsServiceDependencies) {
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  async execute(): Promise<{
    departments: ActiveDepartmentRouting[];
    errorCode: string | null;
    errorMessage: string | null;
  }> {
    const result = await this.repository.getActiveDepartmentsWithApprovers();

    if (result.errorMessage) {
      this.logger.error("departments.active.fetch_failed", {
        errorMessage: result.errorMessage,
      });

      return {
        departments: [],
        errorCode: "DEPARTMENTS_FETCH_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    const validDepartments = result.data.filter((department) => {
      const hasRoutingUsers = Boolean(department.hod?.id) && Boolean(department.founder?.id);
      if (!hasRoutingUsers) {
        this.logger.warn("departments.active.invalid_routing_mapping", {
          departmentId: department.id,
          departmentName: department.name,
        });
      }

      return hasRoutingUsers;
    });

    this.logger.info("departments.active.fetch_success", {
      totalCount: validDepartments.length,
    });

    return {
      departments: validDepartments,
      errorCode: null,
      errorMessage: null,
    };
  }
}
