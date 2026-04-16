import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";

export function DangerZoneCard() {
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleClear = async (type: string, description: string) => {
    setIsDeleting(type);
    try {
      const res = await fetch('/api/data/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) throw new Error('Failed to clear data');
      toast({ title: "Data cleared", description });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      toast({ title: "Error", description: "Failed to clear data. Please try again.", variant: "destructive" });
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-700">
          <Trash2 className="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <p className="text-sm text-gray-600">
          Irreversible actions that delete analysis data
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Delete results only */}
        <div className="flex items-center justify-between p-4 bg-amber-50 rounded-lg border border-amber-200">
          <div>
            <h4 className="font-medium text-amber-900">Delete results only</h4>
            <p className="text-sm text-amber-700 mt-1">
              Deletes responses, competitors, sources, analysis runs, and cost data.
              Keeps your prompts, topics, and settings so you can re-run analysis.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="ml-4 shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100" disabled={!!isDeleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting === 'results' ? 'Deleting...' : 'Delete Results'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete analysis results?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete all responses, competitors, sources, analysis runs, and cost logs.
                  Your prompts and topics will be preserved. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleClear('results', 'Results cleared. Prompts and topics preserved.')}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  Yes, delete results
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Delete everything */}
        <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-200">
          <div>
            <h4 className="font-medium text-red-900">Delete everything</h4>
            <p className="text-sm text-red-700 mt-1">
              Deletes all prompts, topics, responses, competitors, sources, runs, and cost data.
              Only settings are preserved.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="ml-4 shrink-0" disabled={!!isDeleting}>
                <Trash2 className="h-4 w-4 mr-2" />
                {isDeleting === 'nuclear' ? 'Deleting...' : 'Delete All Data'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete ALL analysis data including prompts, topics,
                  responses, competitors, sources, analysis runs, and cost logs.
                  Only your settings will be preserved. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => handleClear('nuclear', 'All data cleared. Settings preserved.')}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Yes, delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
