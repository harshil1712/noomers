import { Chart, TimeseriesChart, type TimeseriesData } from "@cloudflare/kumo/components/chart";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { themeColor } from "../../lib/use-is-dark";

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export function SiteTrend({ points, isDark }: { points: [number, number][]; isDark: boolean }) {
  const color = themeColor("--color-kumo-brand");
  return (
    <Chart
      echarts={echarts}
      height={48}
      options={{
        animation: false,
        grid: { left: 0, right: 0, top: 2, bottom: 1 },
        xAxis: { type: "time", show: false },
        yAxis: { type: "value", show: false, min: "dataMin" },
        series: [
          {
            type: "line",
            data: points,
            showSymbol: false,
            silent: true,
            lineStyle: { width: 1.5, color },
            areaStyle: { color, opacity: isDark ? 0.18 : 0.12 },
          },
        ],
      }}
    />
  );
}

export function DashboardTrend({ data, isDark }: { data: TimeseriesData[]; isDark: boolean }) {
  return (
    <TimeseriesChart
      echarts={echarts}
      isDarkMode={isDark}
      data={data}
      height={300}
      yAxisMinInterval={1}
    />
  );
}
