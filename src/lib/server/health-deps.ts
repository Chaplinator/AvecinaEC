import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { serverEnv } from "@/lib/server/env";
import type { HealthDeps } from "@/lib/server/health";

let cached: HealthDeps | null = null;

// Dependencias reales del chequeo de salud. Si falta configuración, lanza y la ruta responde "degraded".
export function getHealthDeps(): HealthDeps {
  if (cached) return cached;
  const env = serverEnv();
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  cached = {
    async checkDb() {
      // Una lectura mínima: comprueba la conexión y además cuenta como actividad (el plan gratuito
      // de Supabase pausa los proyectos inactivos y el monitor seguiría en verde sin esto).
      const { error } = await admin.from("config").select("key").limit(1);
      if (error) throw new Error("db");
    },
    async checkRedis() {
      await redis.ping();
    },
    log(component) {
      console.error(JSON.stringify({ level: "error", event: "health_degraded", component }));
    },
  };
  return cached;
}
