import { MyClaimsPageSkeleton } from "./_skeletons";

export default function MyClaimsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] pb-16">
      <MyClaimsPageSkeleton />
    </div>
  );
}
