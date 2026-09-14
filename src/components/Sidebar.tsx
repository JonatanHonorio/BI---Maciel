"use client";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

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

const grupos: { titulo: string; links: { href: string; label: string; icon: typeof Users }[] }[] = [
  {
    titulo: "Visão geral",
    links: [
      { href: "/resumo", label: "Resumo", icon: LayoutDashboard },
      { href: "/estrategico", label: "Estratégico", icon: TrendingUp },
      { href: "/metas", label: "Metas", icon: Target },
    ],
  },
  {
    titulo: "Equipe",
    links: [
      { href: "/produtividade", label: "Produtividade", icon: Gauge },
      { href: "/corretores", label: "Corretores", icon: Users },
      { href: "/funil", label: "Funil Comercial", icon: Filter },
    ],
  },
  {
    titulo: "Negócio",
    links: [
      { href: "/vendas", label: "Vendas", icon: DollarSign },
      { href: "/imoveis", label: "Imóveis", icon: Building2 },
      { href: "/lais", label: "Lais Visitas", icon: Bot },
    ],
  },
  {
    titulo: "Marketing",
    links: [
      { href: "/trafego", label: "Tráfego", icon: Megaphone },
      { href: "/criativos", label: "Criativos", icon: Trophy },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed top-0 left-0 z-30 flex h-screen w-56 flex-col bg-slate-900 text-slate-300">
      <div className="px-5 pt-5 pb-4">
        <h1 className="text-[15px] leading-tight font-semibold tracking-tight text-white">
          BI Maciel
        </h1>
        <p className="mt-0.5 text-[11px] text-slate-400">Imobiliária Maciel</p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {grupos.map((grupo) => (
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
        <p className="text-[10px] leading-relaxed text-slate-500">
          Maciel Negócios Imobiliários
        </p>
      </div>
    </aside>
  );
}
