import { type ZodType } from 'zod';

export function validate<T>(schema: ZodType<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const error = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    return { success: false, error };
  }
  return { success: true, data: result.data };
}
