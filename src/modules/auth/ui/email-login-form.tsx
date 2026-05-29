"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  const inputClass =
    "h-[44px] w-full rounded-[var(--radius-md)] border border-border bg-input-bg px-3 text-sm text-foreground shadow-sm outline-none transition-all placeholder:text-muted-foreground focus:border-accent focus:ring-[3px] focus:ring-accent/15";

  return (
    <form className="grid gap-4" onSubmit={handleSubmit((values) => void onSubmit(values))}>
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Work Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          className={inputClass}
          {...register("email")}
        />
        {errors.email ? <p className="text-xs text-danger">{errors.email.message}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-sm font-medium text-foreground">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            className={`${inputClass} pr-11`}
            {...register("password")}
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password ? <p className="text-xs text-danger">{errors.password.message}</p> : null}
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        loading={loading}
        loadingText="Processing..."
        className="mt-2 h-[44px] w-full rounded-[var(--radius-md)] bg-accent text-accent-foreground shadow-sm transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        Sign in with Email
      </Button>
    </form>
  );
}
