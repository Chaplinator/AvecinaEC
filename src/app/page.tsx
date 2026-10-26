import { connection } from "next/server";
import HomeClient from "@/components/HomeClient";

// El CSP con nonce exige renderizado dinámico: el nonce se aplica por petición.
export default async function Home() {
  await connection();
  return <HomeClient />;
}
