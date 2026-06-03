"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
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
        <label htmlFor="email" className="text-[13px] font-medium text-foreground">
          Work Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="name@nxtwave.co.in"
          className={cn(
            "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground",
            "focus:border-accent focus:ring-2 focus:ring-accent/20",
            errors.email && "border-danger/50 focus:border-danger focus:ring-danger/20",
          )}
          {...register("email")}
        />
        {errors.email ? <p className="text-xs text-danger">{errors.email.message}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-[13px] font-medium text-foreground">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            className={cn(
              "h-10 w-full rounded-lg border border-border bg-card px-3 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground",
              "focus:border-accent focus:ring-2 focus:ring-accent/20",
              errors.password && "border-danger/50 focus:border-danger focus:ring-danger/20",
            )}
            {...register("password")}
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password ? <p className="text-xs text-danger">{errors.password.message}</p> : null}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
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
