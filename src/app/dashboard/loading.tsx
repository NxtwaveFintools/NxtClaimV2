export default function DashboardLoading() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <aside
        className="fixed left-0 top-0 bottom-0 flex flex-col"
        style={{
          width: 240,
          backgroundColor: "var(--card)",
          borderRight: "1px solid var(--border)",
          zIndex: 30,
        }}
      >
        <div
          className="flex h-14 shrink-0 items-center px-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div
            className="shimmer-sweep h-5 w-5 rounded"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep ml-2.5 h-4 w-24 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
        </div>
        <div className="flex-1 space-y-1 px-2 pt-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`nav-skeleton-${index}`}
              className="shimmer-sweep h-10 rounded-md"
              style={{ margin: "2px 0", backgroundColor: "var(--background-secondary)" }}
            />
          ))}
        </div>
        <div
          className="flex h-16 shrink-0 items-center px-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div
            className="shimmer-sweep h-8 w-8 rounded-full"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div className="ml-2.5 flex-1 space-y-1.5">
            <div
              className="shimmer-sweep h-3 w-20 rounded-md"
              style={{ backgroundColor: "var(--background-secondary)" }}
            />
            <div
              className="shimmer-sweep h-2.5 w-28 rounded-md"
              style={{ backgroundColor: "var(--background-secondary)" }}
            />
          </div>
        </div>
      </aside>

      <main
        style={{
          marginLeft: 240,
          padding: 32,
          backgroundColor: "var(--background)",
          minHeight: "100vh",
        }}
      >
        <div className="space-y-2">
          <div
            className="shimmer-sweep h-7 w-64 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep h-4 w-full max-w-[520px] rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep h-3 w-48 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
        </div>
        <div className="mt-5 flex gap-2">
          <div
            className="shimmer-sweep h-9 w-28 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep h-9 w-28 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
        </div>

        <div className="mb-8 mt-8" />

        <div
          className="shimmer-sweep mb-4 h-4 w-32 rounded-md"
          style={{ backgroundColor: "var(--background-secondary)" }}
        />

        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`wallet-skeleton-${index}`}
              className="rounded-lg border p-5"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
            >
              <div className="flex items-start justify-between">
                <div
                  className="shimmer-sweep h-4 w-24 rounded-md"
                  style={{ backgroundColor: "var(--background-secondary)" }}
                />
                <div
                  className="shimmer-sweep h-8 w-8 rounded-md"
                  style={{ backgroundColor: "var(--background-secondary)" }}
                />
              </div>
              <div
                className="shimmer-sweep mt-3 h-8 w-32 rounded-md"
                style={{ backgroundColor: "var(--background-secondary)" }}
              />
              <div
                className="shimmer-sweep mt-2 h-3 w-full rounded-md"
                style={{ backgroundColor: "var(--background-secondary)" }}
              />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
