"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import type { LoginFormValues } from "@/modules/auth/validators/login-schema";
import { loginFormSchema } from "@/modules/auth/validators/login-schema";

type EmailLoginFormProps = {
  loading: boolean;
  onSubmit: (values: LoginFormValues) => Promise<void>;
};

export function EmailLoginForm({ loading, onSubmit }: EmailLoginFormProps) {
  const [showPassword, setShowPassword] = useState(false);
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
    <form className="grid gap-4" onSubmit={handleSubmit((values) => void onSubmit(values))}>
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Work Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none ring-indigo-500/20 transition-all focus:border-indigo-500 focus:ring-4 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20"
          {...register("email")}
        />
        {errors.email ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">{errors.email.message}</p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 pr-10 text-sm text-zinc-900 shadow-sm outline-none ring-indigo-500/20 transition-all focus:border-indigo-500 focus:ring-4 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-400/20"
            {...register("password")}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">{errors.password.message}</p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
