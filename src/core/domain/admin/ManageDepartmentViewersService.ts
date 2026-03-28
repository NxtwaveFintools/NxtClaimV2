import type {
  AdminDomainLogger,
  AdminRepository,
  DepartmentViewerAdminRecord,
} from "@/core/domain/admin/contracts";

type Dependencies = {
  repository: AdminRepository;
  logger: AdminDomainLogger;
};

type GetViewersResult = {
  data: DepartmentViewerAdminRecord[];
  errorCode: string | null;
  errorMessage: string | null;
};

type AddViewerResult = {
  data: DepartmentViewerAdminRecord | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type RemoveViewerResult = {
  success: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

export class ManageDepartmentViewersService {
  private readonly repository: AdminRepository;
  private readonly logger: AdminDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async getDepartmentViewers(): Promise<GetViewersResult> {
    const result = await this.repository.getDepartmentViewers();

    if (result.errorMessage) {
      this.logger.error("ManageDepartmentViewersService.getDepartmentViewers.failed", {
        errorMessage: result.errorMessage,
      });
      return { data: [], errorCode: "FETCH_FAILED", errorMessage: result.errorMessage };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async addViewerByEmail(departmentId: string, email: string): Promise<AddViewerResult> {
    const trimmedEmail = email?.trim().toLowerCase();

    if (!departmentId?.trim()) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "Department ID is required.",
      };
    }

    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "A valid email address is required.",
      };
    }

    this.logger.info("ManageDepartmentViewersService.addViewerByEmail", {
      departmentId,
      email: trimmedEmail,
    });

    const result = await this.repository.addDepartmentViewerByEmail(departmentId, trimmedEmail);

    if (result.errorMessage) {
      this.logger.error("ManageDepartmentViewersService.addViewerByEmail.failed", {
        departmentId,
        email: trimmedEmail,
        errorMessage: result.errorMessage,
      });
      return {
        data: null,
        errorCode: "ADD_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    return { data: result.data, errorCode: null, errorMessage: null };
  }

  async removeViewer(viewerId: string): Promise<RemoveViewerResult> {
    if (!viewerId?.trim()) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "Viewer ID is required.",
      };
    }

    this.logger.info("ManageDepartmentViewersService.removeViewer", { viewerId });

    const result = await this.repository.removeDepartmentViewer(viewerId);

    if (!result.success) {
      this.logger.error("ManageDepartmentViewersService.removeViewer.failed", {
        viewerId,
        errorMessage: result.errorMessage,
      });
      return {
        success: false,
        errorCode: "REMOVE_FAILED",
        errorMessage: result.errorMessage ?? "Failed to remove viewer.",
      };
    }

    return { success: true, errorCode: null, errorMessage: null };
  }
}
