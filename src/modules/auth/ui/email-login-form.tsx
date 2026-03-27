"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { LoginFormValues } from "@/modules/auth/validators/login-schema";
import { loginFormSchema } from "@/modules/auth/validators/login-schema";

type EmailLoginFormProps = {
  loading: boolean;
  onSubmit: (values: LoginFormValues) => Promise<void>;
};

export function EmailLoginForm({ loading, onSubmit }: EmailLoginFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  return (
    <form className="grid gap-3" onSubmit={handleSubmit((values) => void onSubmit(values))}>
      <div className="grid gap-1">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700">
          Work Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none ring-indigo-500 transition focus:ring"
          {...register("email")}
        />
        {errors.email ? <p className="text-xs text-rose-600">{errors.email.message}</p> : null}
      </div>

      <div className="grid gap-1">
        <label htmlFor="password" className="text-sm font-medium text-zinc-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className="rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none ring-indigo-500 transition focus:ring"
          {...register("password")}
        />
        {errors.password ? (
          <p className="text-xs text-rose-600">{errors.password.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 20 20"
              aria-hidden="true"
              fill="none"
            >
              <circle
                cx="10"
                cy="10"
                r="7"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="2"
              />
              <path
                d="M10 3a7 7 0 0 1 7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Processing...
          </>
        ) : (
          "Sign in with Email"
        )}
      </button>
    </form>
  );
}
