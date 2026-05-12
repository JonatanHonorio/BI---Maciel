"use client";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

interface BarChartCardProps {
  title: string;
  data: Record<string, unknown>[];
  xKey: string;
  bars: { key: string; color: string; label: string }[];
  height?: number;
  layout?: "horizontal" | "vertical";
  stacked?: boolean;
}

export default function BarChartCard({
  title,
  data,
  xKey,
  bars,
  height = 280,
  layout = "vertical",
  stacked = false,
}: BarChartCardProps) {
  if (layout === "horizontal") {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11 }} width={80} />
            <Tooltip />
            {bars.map((bar) => (
              <Bar key={bar.key} dataKey={bar.key} fill={bar.color} name={bar.label} radius={[0, 4, 4, 0]} stackId={stacked ? "stack" : undefined} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data}>
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
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {bars.map((bar) => (
            <Bar key={bar.key} dataKey={bar.key} fill={bar.color} name={bar.label} radius={[4, 4, 0, 0]} stackId={stacked ? "stack" : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
