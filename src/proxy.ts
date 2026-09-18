import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rotaPermitida, rotaInicial } from "@/lib/permissoes";

const ROTAS_MARKETING = ["/trafego", "/criativos", "/api/trafego", "/api/criativos"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ehApi = pathname.startsWith("/api");

  // getSession já aplica o "ver como" quando ativo — um admin simulando um
  // gerente é barrado do Marketing exatamente como o gerente de verdade seria.
  const session = getSession(req);

  if (!session) {
    if (ehApi) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Perfil que só enxerga parte do BI (gerente administrativa: fechamento e
  // comissões). O destino do redirect é a própria rota inicial dela — mandar
  // pro /resumo daria loop, já que ela também não pode ver o resumo.
  if (!rotaPermitida(session, pathname)) {
    if (ehApi) return NextResponse.json({ error: "sem acesso" }, { status: 403 });
    return NextResponse.redirect(new URL(rotaInicial(session), req.url));
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
     * - /api/auth/* (login, logout, esqueci/redefinir senha, ver-como)
     * - /api/corretor (consumido pelo Apps Script da planilha de leads;
     *   autentica sozinho por Bearer BI_API_TOKEN ou cookie de sessão)
     * - /_next (assets do Next.js)
     * - /favicon.ico, /icon, etc.
     */
    "/((?!login|reset-password|api/auth|api/corretor|_next|favicon\\.ico|icon).*)",
  ],
};
