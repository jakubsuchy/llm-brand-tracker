import { useState } from "react";
import { format, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DateRangeValue = { from?: Date; to?: Date };

const PRESETS = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: 0 },
] as const;

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
  onApply?: (range: DateRangeValue) => void;
}

export function DateRangePicker({ value, onChange, onApply }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const activePreset = PRESETS.find(p => {
    if (p.days === 0) return !value.from && !value.to;
    if (!value.from) return false;
    const expected = subDays(new Date(), p.days);
    return Math.abs(value.from.getTime() - expected.getTime()) < 60_000 && !value.to;
  });

  const displayLabel = activePreset
    ? activePreset.label
    : value.from
      ? `${format(value.from, "MMM d")} – ${value.to ? format(value.to, "MMM d") : "now"}`
      : "All time";

  const handlePreset = (days: number) => {
    const range = days === 0 ? {} : { from: subDays(new Date(), days) };
    onChange(range);
    onApply?.(range);
    setOpen(false);
  };

  const handleCalendarSelect = (range: DateRange | undefined) => {
    onChange({ from: range?.from, to: range?.to });
  };

  const handleApply = () => {
    onApply?.(value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 text-xs justify-start text-left font-normal", !value.from && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
          {displayLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex">
          <div className="border-r p-2 space-y-1">
            {PRESETS.map(p => (
              <button
                key={p.days}
                className={cn(
                  "block w-full text-left text-sm px-3 py-1.5 rounded hover:bg-slate-100",
                  activePreset?.days === p.days && "bg-slate-100 font-medium"
                )}
                onClick={() => handlePreset(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <Calendar
              mode="range"
              selected={{ from: value.from, to: value.to }}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
            {onApply && (
              <div className="border-t px-3 py-2 flex justify-end">
                <Button size="sm" className="h-7 text-xs" onClick={handleApply}>
                  Apply
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
