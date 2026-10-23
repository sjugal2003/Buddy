"use client";

import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeeklySentimentPoint } from "@/lib/analytics";
import { sentimentColors, sentimentLabels } from "@/lib/labels";
import type { Sentiment } from "@/lib/types";

const order: Sentiment[] = ["very_negative", "negative", "neutral", "positive"];

export function SentimentTrendChart({ data }: { data: WeeklySentimentPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(l) => `Week of ${l}`} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
          {order.map((s) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              name={sentimentLabels[s]}
              stackId="1"
              stroke={sentimentColors[s]}
              fill={sentimentColors[s]}
              fillOpacity={0.55}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
