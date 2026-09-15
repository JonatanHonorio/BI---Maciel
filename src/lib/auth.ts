import jwt from "jsonwebtoken";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import type { Tipo } from "./unidade";

export interface Session {
  id: number;
  email: string;
  nome: string;
  role: "admin" | "gerente";
  unidade: string | null;
  tipo: Tipo | null;
  marketing: boolean;
}

export const SESSION_COOKIE = "bi_session";
const EXPIRES_IN = "7d";

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET não configurado");
  return s;
}

export function signSession(session: Session): string {
  return jwt.sign(session, secret(), { expiresIn: EXPIRES_IN });
}

function verifyToken(token: string | undefined): Session | null {
  if (!token) return null;
  try {
    return jwt.verify(token, secret()) as unknown as Session;
  } catch {
    return null;
  }
}

/** Route Handlers (`req.cookies`). */
export function getSession(req: NextRequest): Session | null {
  return verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Server Components / layouts (`next/headers`). */
export async function getSessionFromCookies(): Promise<Session | null> {
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}
