import { useEffect, useRef } from 'react';

type SparklineProps = {
  values: number[];
  colorVar: '--accent' | '--danger' | '--warning';
  height?: number;
};

export function Sparkline({ values, colorVar, height = 64 }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const width = Math.max(120, Math.floor(canvas.clientWidth || 0));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const styles = getComputedStyle(document.documentElement);
    const color = styles.getPropertyValue(colorVar).trim() || '#0a7b82';
    const border = styles.getPropertyValue('--border').trim() || '#d4dde8';
    const surface = styles.getPropertyValue('--surface-elevated').trim() || '#ffffff';

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, width, height);

    if (values.length < 2) {
      ctx.strokeStyle = border;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
      return;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = Math.max(1e-9, max - min);
    const padX = 6;
    const padY = 6;
    const chartWidth = width - padX * 2;
    const chartHeight = height - padY * 2;

    const points = values.map((value, index) => {
      const x = padX + (index / Math.max(1, values.length - 1)) * chartWidth;
      const normalized = (value - min) / spread;
      const y = padY + chartHeight - normalized * chartHeight;
      return { x, y };
    });

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = border;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  }, [colorVar, height, values]);

  return <canvas ref={canvasRef} className="sparkline" aria-hidden="true" />;
}
