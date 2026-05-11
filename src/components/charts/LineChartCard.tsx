"use client";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface LineChartCardProps {
  title: string;
  data: Record<string, unknown>[];
  xKey: string;
  lines: { key: string; color: string; label: string }[];
  height?: number;
  formatY?: (v: number) => string;
}

export default function LineChartCard({
  title,
  data,
  xKey,
  lines,
  height = 280,
  formatY,
}: LineChartCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => {
              if (typeof v === "string" && v.length >= 10 && v[4] === "-") {
                return v.substring(8, 10) + "/" + v.substring(5, 7);
              }
              return v;
            }}
          />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={formatY} />
          <Tooltip
            formatter={(value, name) => {
              const v = Number(value);
              const n = String(name);
              const line = lines.find((l) => l.key === n);
              return [formatY ? formatY(v) : v.toLocaleString("pt-BR"), line?.label || n];
            }}
            labelFormatter={(v) => {
              if (typeof v === "string" && v.includes("-")) {
                const d = new Date(v + "T12:00:00");
                return d.toLocaleDateString("pt-BR");
              }
              return v;
            }}
          />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              name={line.key}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
