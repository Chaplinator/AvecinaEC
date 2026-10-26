import { Suspense } from "react";
import { connection } from "next/server";
import { es } from "@/i18n/es";

// El CSP con nonce exige renderizado dinámico: el nonce se aplica por petición.
async function Content() {
  await connection();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">{es.app.name}</h1>
      <p className="max-w-sm text-lg">{es.app.description}</p>
      <p className="text-sm">
        {es.app.unofficial} {es.app.emergency}
      </p>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
