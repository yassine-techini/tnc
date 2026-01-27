import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  AreaSeries,
  LineSeries,
  CandlestickSeries,
  HistogramSeries,
  UTCTimestamp,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export interface PriceDataPoint {
  time: UTCTimestamp;
  value: number;
}

export interface CandlestickDataPoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface VolumeDataPoint {
  time: UTCTimestamp;
  value: number;
  color: string;
}

interface PriceChartProps {
  data: PriceDataPoint[];
  candlestickData?: CandlestickDataPoint[];
  volumeData?: VolumeDataPoint[];
  height?: number;
  showVolume?: boolean;
  chartType?: 'area' | 'line' | 'candlestick' | 'histogram';
  priceFormat?: {
    precision: number;
    minMove: number;
  };
  colors?: {
    upColor?: string;
    downColor?: string;
    lineColor?: string;
    areaTopColor?: string;
    areaBottomColor?: string;
    histogramColor?: string;
  };
  onCrosshairMove?: (price: number | null, time: UTCTimestamp | null) => void;
}

export default function PriceChart({
  data,
  candlestickData,
  volumeData,
  height = 300,
  showVolume = false,
  chartType = 'area',
  priceFormat = { precision: 0, minMove: 1 },
  colors = {},
  onCrosshairMove,
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | ISeriesApi<'Histogram'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  const {
    upColor = '#22c55e',
    downColor = '#ef4444',
    lineColor = '#D4AF37',
    areaTopColor = 'rgba(212, 175, 55, 0.4)',
    areaBottomColor = 'rgba(212, 175, 55, 0.0)',
    histogramColor = '#D4AF37',
  } = colors;

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.5)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(51, 65, 85, 0.5)', style: LineStyle.Dotted },
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#D4AF37',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#D4AF37',
        },
        horzLine: {
          color: '#D4AF37',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#D4AF37',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(51, 65, 85, 0.5)',
        scaleMargins: {
          top: 0.1,
          bottom: showVolume ? 0.25 : 0.1,
        },
      },
      timeScale: {
        borderColor: 'rgba(51, 65, 85, 0.5)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: UTCTimestamp) => {
          const date = new Date(time * 1000);
          return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current = chart;

    // Create series based on chart type - using v5 API
    let series: ISeriesApi<'Area'> | ISeriesApi<'Line'> | ISeriesApi<'Candlestick'> | ISeriesApi<'Histogram'>;

    if (chartType === 'candlestick' && candlestickData && candlestickData.length > 0) {
      series = chart.addSeries(CandlestickSeries, {
        upColor: upColor,
        downColor: downColor,
        borderUpColor: upColor,
        borderDownColor: downColor,
        wickUpColor: upColor,
        wickDownColor: downColor,
        priceFormat: priceFormat,
      });
      series.setData(candlestickData);
    } else if (chartType === 'histogram') {
      series = chart.addSeries(HistogramSeries, {
        color: histogramColor,
        priceFormat: priceFormat,
      });
      series.setData(data);
    } else if (chartType === 'line') {
      series = chart.addSeries(LineSeries, {
        color: lineColor,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: lineColor,
        crosshairMarkerBackgroundColor: '#1e293b',
        priceFormat: priceFormat,
      });
      series.setData(data);
    } else {
      // Default to area chart
      series = chart.addSeries(AreaSeries, {
        lineColor: lineColor,
        lineWidth: 2,
        topColor: areaTopColor,
        bottomColor: areaBottomColor,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: lineColor,
        crosshairMarkerBackgroundColor: '#1e293b',
        priceFormat: priceFormat,
      });
      series.setData(data);
    }

    seriesRef.current = series;

    // Add volume histogram if enabled
    if (showVolume && volumeData && volumeData.length > 0) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });
      volumeSeries.setData(volumeData);
      volumeSeriesRef.current = volumeSeries;
    }

    // Add price line for current price
    if (data.length > 0) {
      const lastPrice = data[data.length - 1].value;
      const firstPrice = data[0].value;
      setCurrentPrice(lastPrice);
      setPriceChange(((lastPrice - firstPrice) / firstPrice) * 100);

      series.createPriceLine({
        price: lastPrice,
        color: lastPrice >= firstPrice ? upColor : downColor,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Actuel',
      });
    }

    // Subscribe to crosshair move
    chart.subscribeCrosshairMove((param) => {
      if (param.time && param.seriesData.size > 0) {
        const priceData = param.seriesData.get(series);
        if (priceData) {
          const price = 'value' in priceData ? priceData.value : ('close' in priceData ? priceData.close : null);
          if (price !== undefined && price !== null) {
            onCrosshairMove?.(price, param.time as UTCTimestamp);
          }
        }
      } else {
        onCrosshairMove?.(null, null);
      }
    });

    // Fit content
    chart.timeScale().fitContent();

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data, candlestickData, volumeData, height, showVolume, chartType, priceFormat, upColor, downColor, lineColor, areaTopColor, areaBottomColor, histogramColor, onCrosshairMove]);

  return (
    <div className="relative">
      {/* Price info overlay */}
      {currentPrice !== null && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-3">
          <span className="text-lg font-bold text-white">
            {currentPrice.toLocaleString('fr-FR')} FCFA
          </span>
          <span className={`text-sm font-medium px-2 py-0.5 rounded ${
            priceChange >= 0
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}>
            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
          </span>
        </div>
      )}

      {/* Chart container */}
      <div ref={chartContainerRef} className="w-full" />

      {/* Watermark */}
      <div className="absolute bottom-2 right-2 text-xs text-slate-600 pointer-events-none">
        TNC Trading
      </div>
    </div>
  );
}
