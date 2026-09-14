"use client";
import { type LucideIcon } from "lucide-react";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Card de KPI do BI.
 *
 * Desenho adaptado do "Stat Card" do 21st.dev (@felipemenezes098): rótulo
 * discreto em cima, número grande, e o ícone num quadrado de fundo neutro no
 * canto — em vez de um ícone colorido solto ao lado do texto. O ganho é de
 * hierarquia: o olho cai no número, que é o que o gerente vem ler.
 *
 * ⚠️ A API de props é a MESMA de antes de propósito — 8 páginas usam este
 * componente, e mudar a assinatura obrigaria a mexer em todas.
 */

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  meta?: number;
  metaLabel?: string;
  status?: "ok" | "atencao" | "critico" | null;
  compact?: boolean;
}

const CORES_STATUS: Record<string, string> = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  atencao: "bg-amber-50 text-amber-700 border-amber-200",
  critico: "bg-red-50 text-red-700 border-red-200",
};
const ROTULOS_STATUS: Record<string, string> = {
  ok: "OK", atencao: "ATENÇÃO", critico: "CRÍTICO",
};

export default function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-muted-foreground",
  meta,
  metaLabel,
  status,
  compact,
}: KpiCardProps) {
  const pct =
    meta && meta > 0
      ? (Number(value.toString().replace(/[^\d.-]/g, "")) / meta) * 100
      : null;
  const corBarra =
    status === "critico" ? "bg-red-500" : status === "atencao" ? "bg-amber-500" : "bg-emerald-500";

  return (
    <Card className={cn("gap-0 transition-shadow hover:shadow-md", compact ? "py-4" : "py-5")}>
      <CardHeader className={cn(compact && "px-4")}>
        <CardDescription className={cn("font-medium", compact ? "text-[11px]" : "text-xs")}>
          {label}
        </CardDescription>
        <CardTitle
          className={cn(
            "tabular-nums tracking-tight",
            compact ? "text-xl" : "text-2xl"
          )}
        >
          {value}
        </CardTitle>

        {Icon && (
          <CardAction>
            <div
              className={cn(
                // ring-1 alem do fundo: em tela de baixo contraste o fundo
                // sozinho some, e o icone volta a parecer solto no canto.
                "bg-muted ring-border flex items-center justify-center rounded-lg ring-1",
                compact ? "size-7" : "size-9"
              )}
            >
              <Icon className={cn(iconColor, compact ? "size-3.5" : "size-4")} />
            </div>
          </CardAction>
        )}
      </CardHeader>

      {(subtitle || status) && (
        <div className={cn("flex items-center gap-2 pt-2", compact ? "px-4" : "px-6")}>
          {status && (
            <Badge variant="outline" className={cn("text-[10px] font-bold", CORES_STATUS[status])}>
              {ROTULOS_STATUS[status]}
            </Badge>
          )}
          {subtitle && (
            <span className="text-muted-foreground text-xs leading-snug">{subtitle}</span>
          )}
        </div>
      )}

      {meta !== undefined && meta > 0 && (
        <div className={cn("pt-3", compact ? "px-4" : "px-6")}>
          <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
            <div
              className={cn("h-full rounded-full transition-all", corBarra)}
              style={{ width: `${Math.min(pct || 0, 100)}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-1 text-[10px]">
            {metaLabel || `Meta: ${meta.toLocaleString("pt-BR")}`} {pct ? `${pct.toFixed(0)}%` : ""}
          </p>
        </div>
      )}
    </Card>
  );
}
