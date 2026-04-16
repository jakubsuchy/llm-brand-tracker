import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Clock } from "lucide-react";

export function AnalysisScheduleCard() {
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { data, refetch } = useQuery<{ frequency: string; nextRun: string | null }>({
    queryKey: ['/api/settings/analysis-schedule'],
  });

  const handleChange = async (frequency: string) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings/analysis-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency }),
      });
      if (!res.ok) throw new Error('Failed to save');
      refetch();
      toast({ title: "Saved", description: `Analysis schedule set to ${frequency}` });
    } catch {
      toast({ title: "Error", description: "Failed to save schedule", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const nextRun = data?.nextRun ? new Date(data.nextRun) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Analysis Schedule
        </CardTitle>
        <p className="text-sm text-gray-600">
          How often to automatically run brand analysis. Runs at 3:00 AM local time.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Frequency</Label>
          <Select
            value={data?.frequency || 'manual'}
            onValueChange={handleChange}
            disabled={isSaving}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {nextRun && data?.frequency !== 'manual' && (
          <p className="text-sm text-gray-600">
            Next run: {nextRun.toLocaleDateString()} {nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {data?.frequency === 'manual' && (
          <p className="text-sm text-gray-500">
            Analysis will only run when started manually from the Analysis page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
