"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

/** Slider + numeric input kept in sync; submits a single form field. */
export function VolumeInput({
  name,
  defaultValue,
  min = 1,
  max,
  sliderMax,
  id,
  disabled,
}: {
  name: string;
  defaultValue: number;
  min?: number;
  max: number;
  /** Slider range can be shorter than the hard max (fine control for typical values). */
  sliderMax?: number;
  id?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(String(defaultValue));
  const numeric = Number(value);
  const rangeMax = sliderMax ?? max;

  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={`${name} slider`}
        min={min}
        max={rangeMax}
        value={Number.isFinite(numeric) ? Math.min(Math.max(numeric, min), rangeMax) : min}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="accent-primary flex-1"
      />
      <Input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="w-24"
        required
      />
    </div>
  );
}
