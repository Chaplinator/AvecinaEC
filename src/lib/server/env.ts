import { z } from "zod";

// Variables del servidor, validadas una sola vez. Si falta alguna, el error nombra la variable
// (nunca su valor) para que el despliegue falle de forma clara.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  if (cached && source === process.env) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const missing = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Configuración del servidor incompleta o inválida: ${missing.join(", ")}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
