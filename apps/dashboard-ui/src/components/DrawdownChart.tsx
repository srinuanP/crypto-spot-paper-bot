import { LineChartCanvas } from './LineChartCanvas';

type DrawdownChartProps = {
  values: number[];
};

export function DrawdownChart({ values }: DrawdownChartProps) {
  return (
    <LineChartCanvas
      title="เส้นดรอดาวน์"
      chipLabel="ดรอดาวน์"
      chipClassName="chip-danger"
      values={values}
      colorVar="--danger"
      formatValue={(value) => `${(value * 100).toFixed(2)}%`}
      height={240}
    />
  );
}
