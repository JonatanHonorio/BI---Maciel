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
} from "lucide-react";

const links = [
  { href: "/resumo", label: "Resumo", icon: LayoutDashboard },
  { href: "/trafego", label: "Tráfego", icon: Megaphone },
  { href: "/funil", label: "Funil Comercial", icon: Filter },
  { href: "/imoveis", label: "Imóveis", icon: Building2 },
  { href: "/corretores", label: "Corretores", icon: Users },
  { href: "/vendas", label: "Vendas", icon: DollarSign },
  { href: "/estrategico", label: "Estratégico", icon: TrendingUp },
  { href: "/metas", label: "Metas", icon: Target },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-white border-r border-gray-200 flex flex-col z-30">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-blue-900">BI Maciel</h1>
        <p className="text-xs text-gray-500">Imobiliária Maciel</p>
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
        {links.map((link) => {
          const Icon = link.icon;
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                active
                  ? "text-blue-600 bg-blue-50 font-semibold border-r-2 border-blue-600"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon size={18} />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t border-gray-200 text-xs text-gray-400">
        Maciel Negócios Imobiliários
      </div>
    </aside>
  );
}
