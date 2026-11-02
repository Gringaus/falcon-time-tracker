export interface Employee { id: string; name: string; role: string; color: string }
export interface TimeEntry { id: string; employeeId: string; description: string; startedAt: string; stoppedAt: string | null }
export interface AppState { employees: Employee[]; entries: TimeEntry[]; serverNow: string }
export interface ReportData {
  entries: (TimeEntry & { durationMs: number })[];
  summaries: { employeeId: string; totalMs: number; entryCount: number }[];
  totalMs: number; from: string; to: string; serverNow: string;
}
