import { TableSkeleton } from "@/components/ui/table-skeleton";

type ClaimsTableSkeletonProps = {
  rows?: number;
};

const DEFAULT_ROWS = 5;

export function ClaimsTableSkeleton({ rows = DEFAULT_ROWS }: ClaimsTableSkeletonProps) {
  return <TableSkeleton rows={rows} columns={8} showHeaderBar />;
}
