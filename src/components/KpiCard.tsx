"use client";
import { type LucideIcon } from "lucide-react";

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

function formatStatus(status: "ok" | "atencao" | "critico" | null | undefined) {
  if (!status) return null;
  const colors: Record<string, string> = {
    ok: "bg-green-100 text-green-700",
    atencao: "bg-yellow-100 text-yellow-700",
    critico: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = { ok: "OK", atencao: "ATENÇÃO", critico: "CRÍTICO" };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-blue-500",
  meta,
  metaLabel,
  status,
  compact,
}: KpiCardProps) {
  const pct = meta && meta > 0 ? (Number(value.toString().replace(/[^\d.-]/g, "")) / meta) * 100 : null;
  const barColor = status === "critico" ? "bg-red-500" : status === "atencao" ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className={`bg-white rounded-xl border border-gray-200 ${compact ? "p-3" : "p-4"} flex flex-col gap-1`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={compact ? 12 : 14} className={iconColor} />}
          <span className={`${compact ? "text-[11px]" : "text-xs"} text-gray-500 font-medium`}>{label}</span>
        </div>
        {formatStatus(status)}
      </div>
      <div className={`${compact ? "text-xl" : "text-2xl"} font-bold text-gray-900 mt-1`}>{value}</div>
      {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
      {meta !== undefined && meta > 0 && (
        <div className="mt-2">
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${Math.min(pct || 0, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {metaLabel || `Meta: ${meta.toLocaleString("pt-BR")}`} {pct ? `${pct.toFixed(0)}%` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
