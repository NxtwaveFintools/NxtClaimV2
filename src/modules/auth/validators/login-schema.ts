import { z } from "zod";

export const loginFormSchema = z.object({
  email: z.email("Enter a valid work email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;
