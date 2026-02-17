import { LineChartCanvas } from './LineChartCanvas';

type EquityChartProps = {
  values: number[];
};

export function EquityChart({ values }: EquityChartProps) {
  return (
    <LineChartCanvas
      title="เส้นมูลค่าพอร์ต"
      chipLabel="มูลค่าพอร์ต"
      chipClassName="chip-accent"
      values={values}
      colorVar="--accent"
      formatValue={(value) => value.toFixed(2)}
      height={280}
    />
  );
}
