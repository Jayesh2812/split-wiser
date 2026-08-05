import type { Group } from "../types";
import { exportBackupFile, exportCsv, exportPdf } from "../lib/exporter";
import { toast } from "../lib/toast";

interface ExportBarProps {
  group: Group;
  greedy: boolean;
}

export function ExportBar({ group, greedy }: ExportBarProps) {
  const guard = (): boolean => {
    if (group.transactions.length === 0) {
      toast("Add a transaction before exporting.");
      return false;
    }
    return true;
  };

  return (
    <footer className="exportbar">
      <button
        className="btn btn-ghost"
        onClick={() => {
          if (!guard()) return;
          exportCsv(group, greedy);
          toast("CSV exported");
        }}
      >
        ⬇ CSV
      </button>
      <button
        className="btn btn-ghost"
        onClick={() => {
          if (!guard()) return;
          exportPdf(group, greedy);
        }}
      >
        🖨 PDF
      </button>
      <button
        className="btn btn-ghost"
        onClick={() => {
          exportBackupFile();
          toast("Backup downloaded");
        }}
      >
        💾 Backup
      </button>
    </footer>
  );
}
