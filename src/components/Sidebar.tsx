"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Megaphone,
  Filter,
  Building2,
  Users,
  DollarSign,
  TrendingUp,
  Target,
  Bot,
  Trophy,
  Gauge,
  LogOut,
  Eye,
  FileText,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/auth";

type Gerente = { id: number; nome: string; unidade: string | null; tipo: "venda" | "locacao" | null };

/**
 * Barra lateral do BI.
 *
 * Painel escuro de propósito: é o único elemento presente em todas as telas, e
 * escurecê-lo empurra o conteúdo para frente — os cards e tabelas brancos passam
 * a ler como "a informação", e a navegação como moldura. Com tudo branco, os
 * dois disputavam a mesma atenção.
 *
 * Os links vêm agrupados porque dez itens em lista corrida não têm hierarquia:
 * o gerente procurava "Corretores" percorrendo o alfabeto visual inteiro.
 */

type Link_ = { href: string; label: string; icon: typeof Users; somenteAdmin?: boolean; oculto?: boolean };
type Grupo = { titulo: string; links: Link_[]; somenteMarketing?: boolean };

// `oculto` some do menu pra todo mundo (inclusive admin) sem apagar a
// página/rota — pedido do Jonatan em 15/09/2026 pra tirar de vista
// temporariamente. Tirar a flag reativa, sem mexer em mais nada.
const grupos: Grupo[] = [
  {
    titulo: "Visão geral",
    links: [
      { href: "/resumo", label: "Resumo", icon: LayoutDashboard },
      { href: "/estrategico", label: "Estratégico", icon: TrendingUp, oculto: true },
      { href: "/metas", label: "Metas", icon: Target, somenteAdmin: true, oculto: true },
    ],
  },
  {
    titulo: "Equipe",
    links: [
      { href: "/produtividade", label: "Produtividade", icon: Gauge },
      { href: "/corretores", label: "Corretores", icon: Users, oculto: true },
      { href: "/funil", label: "Funil Comercial", icon: Filter, oculto: true },
    ],
  },
  {
    titulo: "Negócio",
    links: [
      { href: "/vendas", label: "Vendas", icon: DollarSign },
      { href: "/imoveis", label: "Imóveis", icon: Building2 },
      { href: "/lais", label: "Lais Visitas", icon: Bot },
      { href: "/fechamento", label: "Fechamento", icon: FileText },
      { href: "/fechamento/comissoes", label: "Comissões", icon: Wallet, somenteAdmin: true },
    ],
  },
  {
    titulo: "Marketing",
    somenteMarketing: true,
    links: [
      { href: "/trafego", label: "Tráfego", icon: Megaphone },
      { href: "/criativos", label: "Criativos", icon: Trophy },
    ],
  },
];

export default function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();
  const [gerentes, setGerentes] = useState<Gerente[]>([]);

  // Admin (todo mundo) ou "diretora" — gerente sem unidade fixa, hoje só a
  // Daniela — podem "ver como". A API decide sozinha o que cada um pode
  // escolher (admin: os 13; diretora: só as 6 do próprio tipo).
  const podeVerComo = session.role === "admin" || (session.role === "gerente" && session.unidade === null);

  // Lista só carrega fora do "ver como" — não faz sentido trocar de gerente
  // enquanto já está simulando um (sai primeiro, pelo banner).
  useEffect(() => {
    if (!podeVerComo || session.verComo) return;
    fetch("/api/auth/ver-como")
      .then((r) => (r.ok ? r.json() : []))
      .then(setGerentes)
      .catch(() => {});
  }, [podeVerComo, session.verComo]);

  const gruposVisiveis = grupos
    .filter((g) => !g.somenteMarketing || session.marketing)
    .map((g) => ({
      ...g,
      links: g.links.filter((l) => !l.oculto && (!l.somenteAdmin || session.role === "admin")),
    }))
    .filter((g) => g.links.length > 0);

  async function sair() {
    await fetch("/api/auth/logout", { method: "POST" });
    // Recarga completa, não router.push: as páginas do dashboard são "use
    // client" e buscam dado sozinhas via useEffect — um router.refresh() só
    // atualiza os Server Components (o layout), deixando o conteúdo com o
    // fetch antigo em tela se a rota de destino for a mesma em que já está.
    window.location.href = "/login";
  }

  async function verComo(userId: string) {
    if (!userId) return;
    await fetch("/api/auth/ver-como", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(userId) }),
    });
    window.location.href = "/resumo";
  }

  return (
    <aside className="fixed top-0 left-0 z-30 flex h-screen w-56 flex-col bg-slate-900 text-slate-300">
      <div className="px-5 pt-5 pb-4">
        <h1 className="text-[15px] leading-tight font-semibold tracking-tight text-white">
          BI Maciel
        </h1>
        <p className="mt-0.5 text-[11px] text-slate-400">Imobiliária Maciel</p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {gruposVisiveis.map((grupo) => (
          <div key={grupo.titulo}>
            <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
              {grupo.titulo}
            </p>
            <div className="space-y-0.5">
              {grupo.links.map((link) => {
                const Icon = link.icon;
                const ativo = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={ativo ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                      ativo
                        ? "bg-slate-800 font-medium text-white"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0 transition-colors",
                        ativo ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300"
                      )}
                    />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 px-5 py-3">
        <p className="truncate text-[12px] font-medium text-slate-200" title={session.nome}>
          {session.nome}
        </p>
        <p className="truncate text-[10px] text-slate-500" title={session.email}>
          {session.unidade ? `${session.unidade} · ` : ""}
          {session.tipo === "venda" ? "Vendas" : session.tipo === "locacao" ? "Locação" : session.role === "admin" ? "Acesso total" : ""}
        </p>
        {podeVerComo && !session.verComo && gerentes.length > 0 && (
          <div className="mt-2.5">
            <label className="mb-1 flex items-center gap-1.5 text-[10px] text-slate-500">
              <Eye className="size-3" />
              Ver como gerente
            </label>
            <select
              defaultValue=""
              onChange={(e) => verComo(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] text-slate-200 outline-none focus:border-slate-500"
            >
              <option value="" disabled>
                Escolher...
              </option>
              {gerentes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome} — {g.unidade ?? "Todas"} · {g.tipo === "venda" ? "Vendas" : "Locação"}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={sair}
          className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-100"
        >
          <LogOut className="size-3.5" />
          Sair
        </button>
      </div>
    </aside>
  );
}
