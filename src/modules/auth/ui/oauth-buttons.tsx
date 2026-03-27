"use client";

type OAuthButtonsProps = {
  loading: boolean;
  onMicrosoftClick: () => Promise<void>;
  onGoogleClick: () => Promise<void>;
};

export function OAuthButtons({ loading, onMicrosoftClick, onGoogleClick }: OAuthButtonsProps) {
  return (
    <div className="grid gap-3">
      <button
        type="button"
        disabled={loading}
        onClick={() => void onMicrosoftClick()}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Sign in with Microsoft
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => void onGoogleClick()}
        className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Sign in with Google
      </button>
    </div>
  );
}
