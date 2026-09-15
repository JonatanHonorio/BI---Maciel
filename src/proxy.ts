import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { SESSION_COOKIE, type Session } from "@/lib/auth";

const ROTAS_MARKETING = ["/trafego", "/criativos", "/api/trafego", "/api/criativos"];

function verificarSessao(req: NextRequest): Session | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET) as unknown as Session;
  } catch {
    return null;
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ehApi = pathname.startsWith("/api");

  const session = verificarSessao(req);

  if (!session) {
    if (ehApi) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (!session.marketing && ROTAS_MARKETING.some((r) => pathname.startsWith(r))) {
    if (ehApi) return NextResponse.json({ error: "sem acesso" }, { status: 403 });
    return NextResponse.redirect(new URL("/resumo", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Protege todas as rotas EXCETO:
     * - /login, /reset-password (páginas públicas)
     * - /api/auth/* (login, logout, esqueci/redefinir senha)
     * - /api/corretor (consumido pelo Apps Script da planilha de leads;
     *   autentica sozinho por Bearer BI_API_TOKEN ou cookie de sessão)
     * - /_next (assets do Next.js)
     * - /favicon.ico, /icon, etc.
     */
    "/((?!login|reset-password|api/auth|api/corretor|_next|favicon\\.ico|icon).*)",
  ],
};
