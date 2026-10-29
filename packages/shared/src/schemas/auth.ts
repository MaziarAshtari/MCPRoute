import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required').max(256),
  password: z.string().min(1, 'Password is required').max(1024),
});
export type LoginInput = z.output<typeof loginSchema>;
