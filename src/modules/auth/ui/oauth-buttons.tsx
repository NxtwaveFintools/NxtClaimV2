"use client";

type OAuthButtonsProps = {
  loading: boolean;
  onMicrosoftClick: () => Promise<void>;
};

export function OAuthButtons({ loading, onMicrosoftClick }: OAuthButtonsProps) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => void onMicrosoftClick()}
      className="flex h-10 w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg className="h-[18px] w-[18px]" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 0H0V10H10V0Z" fill="#F25022" />
        <path d="M21 0H11V10H21V0Z" fill="#7FBA00" />
        <path d="M10 11H0V21H10V11Z" fill="#00A4EF" />
        <path d="M21 11H11V21H21V11Z" fill="#FFB900" />
      </svg>
      Sign in with Microsoft
    </button>
  );
}
