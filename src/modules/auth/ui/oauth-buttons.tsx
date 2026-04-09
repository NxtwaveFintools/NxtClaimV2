"use client";

type OAuthButtonsProps = {
  loading: boolean;
  onMicrosoftClick: () => Promise<void>;
};

export function OAuthButtons({ loading, onMicrosoftClick }: OAuthButtonsProps) {
  return (
    <div className="grid gap-3">
      <button
        type="button"
        disabled={loading}
        onClick={() => void onMicrosoftClick()}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm transition-all hover:bg-zinc-50 hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800/80 dark:hover:border-zinc-700"
      >
        <svg className="h-5 w-5" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 0H0V10H10V0Z" fill="#F25022" />
          <path d="M21 0H11V10H21V0Z" fill="#7FBA00" />
          <path d="M10 11H0V21H10V11Z" fill="#00A4EF" />
          <path d="M21 11H11V21H21V11Z" fill="#FFB900" />
        </svg>
        Sign in with Microsoft
      </button>
    </div>
  );
}
