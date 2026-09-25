"use client";
import { Eye } from "lucide-react";
import type { Session } from "@/lib/auth";
import { escopoDoGerente } from "./Sidebar";

export default function VerComoBanner({ verComo }: { verComo: NonNullable<Session["verComo"]> }) {
  async function voltar() {
    await fetch("/api/auth/ver-como", { method: "DELETE" });
    // Recarga completa — mesmo motivo do Sidebar: páginas "use client" não
    // refazem o fetch sozinhas só porque o layout (Server Component) mudou.
    window.location.href = "/resumo";
  }

  // Mesmo rótulo do seletor da sidebar — com as administrativas no jogo, o
  // texto precisa dizer "Administrativo" e listar as três unidades da Rachel,
  // senão o banner anuncia um escopo que não é o que está em tela.
  const escopo = escopoDoGerente(verComo);

  return (
    <div className="ml-56 flex items-center justify-between gap-3 bg-amber-400 px-6 py-2 text-[13px] font-medium text-amber-950">
      <span className="flex items-center gap-2">
        <Eye className="size-4" />
        Vendo o BI como <strong>{verComo.nome}</strong> — {escopo}
      </span>
      <button
        onClick={voltar}
        className="rounded-md bg-amber-950/10 px-3 py-1 text-[12px] font-semibold hover:bg-amber-950/20"
      >
        Voltar para minha visão
      </button>
    </div>
  );
}
