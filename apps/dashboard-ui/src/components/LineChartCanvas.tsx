import { useEffect, useMemo, useRef, useState } from 'react';

type LineChartCanvasProps = {
  title: string;
  chipLabel: string;
  chipClassName: string;
  values: number[];
  colorVar: '--accent' | '--danger';
  formatValue: (value: number) => string;
  height?: number;
};

type HoverPoint = {
  index: number;
  x: number;
  y: number;
  value: number;
} | null;

function toFiniteSeries(values: number[]): number[] {
  return values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
}

export function LineChartCanvas({
  title,
  chipLabel,
  chipClassName,
  values,
  colorVar,
  formatValue,
  height = 240
}: LineChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverPoint, setHoverPoint] = useState<HoverPoint>(null);

  const series = useMemo(() => toFiniteSeries(values), [values]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = { top: 20, right: 16, bottom: 28, left: 56 };
    let drawPoints: Array<{ x: number; y: number; value: number }> = [];

    const styles = getComputedStyle(document.documentElement);
    const color = styles.getPropertyValue(colorVar).trim() || '#0a7b82';
    const border = styles.getPropertyValue('--border').trim() || '#d4dde8';
    const muted = styles.getPropertyValue('--muted').trim() || '#526479';
    const text = styles.getPropertyValue('--text').trim() || '#13253b';
    const surface = styles.getPropertyValue('--surface-elevated').trim() || '#ffffff';

    const fitCanvas = () => {
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const width = Math.max(260, Math.floor(canvas.clientWidth));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    };

    const draw = (hoverIndex: number | null) => {
      const { width, height: drawHeight } = fitCanvas();
      ctx.clearRect(0, 0, width, drawHeight);
      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, width, drawHeight);

      if (series.length < 2) {
        ctx.fillStyle = muted;
        ctx.font = '14px "IBM Plex Sans", sans-serif';
        ctx.fillText('ยังไม่มีข้อมูลเพียงพอสำหรับกราฟ', 16, 32);
        drawPoints = [];
        return;
      }

      const minRaw = Math.min(...series);
      const maxRaw = Math.max(...series);
      const spread = Math.max(1e-9, maxRaw - minRaw);
      const minValue = minRaw - spread * 0.12;
      const maxValue = maxRaw + spread * 0.12;

      const chartWidth = width - padding.left - padding.right;
      const chartHeight = drawHeight - padding.top - padding.bottom;
      if (chartWidth <= 0 || chartHeight <= 0) return;

      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.font = '12px "IBM Plex Sans", sans-serif';
      ctx.fillStyle = muted;
      for (let i = 0; i <= 4; i += 1) {
        const y = padding.top + (i / 4) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        const value = maxValue - ((maxValue - minValue) * i) / 4;
        ctx.fillText(formatValue(value), 8, y + 4);
      }

      drawPoints = series.map((value, index) => {
        const x = padding.left + (index / Math.max(1, series.length - 1)) * chartWidth;
        const normalized = (value - minValue) / (maxValue - minValue);
        const y = padding.top + chartHeight - normalized * chartHeight;
        return { x, y, value };
      });

      const gradient = ctx.createLinearGradient(0, padding.top, 0, drawHeight - padding.bottom);
      gradient.addColorStop(0, `${color}4a`);
      gradient.addColorStop(1, `${color}08`);

      ctx.beginPath();
      drawPoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.lineTo(width - padding.right, drawHeight - padding.bottom);
      ctx.lineTo(padding.left, drawHeight - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      drawPoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = text;
      ctx.font = '600 12px "IBM Plex Sans", sans-serif';
      ctx.fillText(title, Math.max(padding.left, width - 140), 14);

      if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < drawPoints.length) {
        const point = drawPoints[hoverIndex];
        ctx.beginPath();
        ctx.moveTo(point.x, padding.top);
        ctx.lineTo(point.x, drawHeight - padding.bottom);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = muted;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };

    draw(hoverPoint?.index ?? null);

    const observer = new ResizeObserver(() => {
      draw(hoverPoint?.index ?? null);
    });
    observer.observe(canvas);

    const onMove = (event: MouseEvent) => {
      if (drawPoints.length < 2) {
        setHoverPoint(null);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const nearest = drawPoints.reduce<{ index: number; distance: number }>(
        (prev, point, index) => {
          const distance = Math.abs(point.x - x);
          if (distance < prev.distance) {
            return { index, distance };
          }
          return prev;
        },
        { index: 0, distance: Number.POSITIVE_INFINITY }
      );
      const point = drawPoints[nearest.index];
      setHoverPoint({ index: nearest.index, x: point.x, y: point.y, value: point.value });
      draw(nearest.index);
    };

    const onLeave = () => {
      setHoverPoint(null);
      draw(null);
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    return () => {
      observer.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [colorVar, formatValue, height, hoverPoint?.index, series, title]);

  return (
    <article className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <span className={`chip ${chipClassName}`}>{chipLabel}</span>
      </div>
      <div className="chart-wrap">
        <canvas ref={canvasRef} height={height} aria-label={title} />
        {hoverPoint ? (
          <div className="chart-tooltip" style={{ left: `${hoverPoint.x + 8}px`, top: `${Math.max(8, hoverPoint.y - 42)}px` }}>
            <strong>{title}</strong>
            <div>{formatValue(hoverPoint.value)}</div>
            <div>จุดที่ {hoverPoint.index + 1}</div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
