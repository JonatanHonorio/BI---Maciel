import { NextRequest, NextResponse } from "next/server";
import { getSession, getSessaoReal } from "@/lib/auth";
import { rotaPermitida, rotaInicial, ehDiretoria } from "@/lib/permissoes";

const ROTAS_MARKETING = ["/trafego", "/criativos", "/api/trafego", "/api/criativos"];
const METODOS_DE_LEITURA = ["GET", "HEAD", "OPTIONS"];

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

  /*
   * A diretoria de vendas LÊ o fechamento de todas as unidades e não escreve
   * em nenhuma (03/11/2026): quem lança é a unidade, e a diretora precisava
   * só conferir onde a venda caiu — o caso que motivou isto foi uma venda da
   * Diretoria que podia ter ido parar na Vista Verde.
   *
   * A trava mora aqui, e não nas dez rotas que escrevem, porque aqui não tem
   * como esquecer: rota nova de escrita já nasce coberta.
   *
   * Vale a sessão REAL, não a de "ver como". Sem isso ela escaparia da trava
   * entrando na pele de um gerente — que é justamente como ela navega.
   */
  if (!METODOS_DE_LEITURA.includes(req.method) && pathname.startsWith("/api/fechamento")) {
    if (ehDiretoria(getSessaoReal(req))) {
      return NextResponse.json(
        { error: "A diretoria acompanha o fechamento, mas quem lança é a unidade." },
        { status: 403 }
      );
    }
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
