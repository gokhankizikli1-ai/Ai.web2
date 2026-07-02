import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';

interface PremiumSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  showValue?: boolean;
  valueFormatter?: (v: number) => string;
  color?: string;
}

export default function PremiumSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  showValue = true,
  valueFormatter = (v) => `${v}%`,
  color = '#3B82F6',
}: PremiumSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    if (!isDragging) setLocalValue(value);
  }, [value, isDragging]);

  const percentage = ((localValue - min) / (max - min)) * 100;

  const computeValue = useCallback((clientX: number) => {
    if (!trackRef.current) return min;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const pct = x / rect.width;
    const raw = min + pct * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, stepped));
  }, [min, max, step]);

  // ─── Pointer events (mouse + touch) ───
  // Only call onChange on drag END — not during drag — to prevent
  // storage/write spam and re-render lag while dragging.

  const commitValue = useCallback((val: number) => {
    onChange(val);
  }, [onChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    const newVal = computeValue(e.clientX);
    setLocalValue(newVal);
  }, [computeValue]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const newVal = computeValue(e.clientX);
    setLocalValue(newVal);
    // NOTE: intentionally NOT calling onChange here — visual only
  }, [isDragging, computeValue]);

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      commitValue(localValue);
    }
    setIsDragging(false);
  }, [isDragging, localValue, commitValue]);

  // Touch support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    const newVal = computeValue(touch.clientX);
    setLocalValue(newVal);
  }, [computeValue]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const newVal = computeValue(touch.clientX);
    setLocalValue(newVal);
    // NOTE: intentionally NOT calling onChange here — visual only
  }, [isDragging, computeValue]);

  const handleTouchEnd = useCallback(() => {
    if (isDragging) {
      commitValue(localValue);
    }
    setIsDragging(false);
  }, [isDragging, localValue, commitValue]);

  return (
    <div className="w-full select-none">
      {(label || showValue) && (
        <div className="flex items-center justify-between mb-2">
          {label && <span className="text-[11px] text-[#94A3B8]">{label}</span>}
          {showValue && (
            <motion.span
              className="text-[11px] font-mono tabular-nums font-medium"
              style={{ color }}
              animate={{ scale: isDragging ? 1.15 : 1 }}
              transition={{ duration: 0.15 }}
            >
              {valueFormatter(localValue)}
            </motion.span>
          )}
        </div>
      )}

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-6 flex items-center cursor-pointer touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Background track */}
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/[0.04]" />

        {/* Filled track */}
        <motion.div
          className="absolute left-0 h-[3px] rounded-full"
          style={{
            background: `linear-gradient(to right, ${color}30, ${color})`,
          }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: isDragging ? 0 : 0.25, ease: 'easeOut' }}
        />

        {/* Glow line on drag */}
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute left-0 h-[3px] rounded-full blur-[2px]"
            style={{
              background: color,
              width: `${percentage}%`,
              opacity: 0.3,
            }}
          />
        )}

        {/* Thumb */}
        <motion.div
          className="absolute rounded-full border-2"
          style={{
            left: `calc(${percentage}% - 8px)`,
            width: 16,
            height: 16,
            borderColor: isDragging ? color : `${color}60`,
            backgroundColor: isDragging ? color : '#0c0c14',
            boxShadow: isDragging ? `0 0 16px ${color}50, 0 0 4px ${color}30` : 'none',
          }}
          animate={{
            scale: isDragging ? 1.2 : 1,
          }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}
