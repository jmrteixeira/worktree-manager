import type {
  DiagnosticEventInput,
  DiagnosticsSnapshot,
  OperationRecord,
  OperationStats
} from "../src/types";
import type { AppStore } from "./store";

const APP_VERSION = "1.0.0";
const SUMMARY_LIMIT = 240;

export async function getDiagnosticsSnapshot(
  store: AppStore,
  runtime: DiagnosticsSnapshot["runtime"] = "node",
  platform: string = process.platform
): Promise<DiagnosticsSnapshot> {
  const [repos, operations, settings] = await Promise.all([
    store.listRepos(),
    store.listOperations(),
    store.getSettings()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    runtime,
    platform,
    statePath: store.stateFilePath(),
    repositoryCount: repos.length,
    operationCount: operations.length,
    operationStats: summarizeOperationStats(operations),
    recentFailures: operations.filter((operation) => operation.status === "error").slice(0, 5),
    settings
  };
}

export async function recordDiagnosticEvent(
  store: AppStore,
  input: DiagnosticEventInput
): Promise<OperationRecord> {
  const event = normalizeDiagnosticEvent(input);
  const isError = event.level === "error";
  const context = event.context ? JSON.stringify(event.context, null, 2) : "";

  return store.recordOperation({
    command: "app",
    args: ["diagnostic", event.level, event.name],
    cwd: "worktree-manager",
    startedAt: new Date().toISOString(),
    status: isError ? "error" : "success",
    exitCode: isError ? 1 : 0,
    summary: event.message.slice(0, SUMMARY_LIMIT),
    stdout: context,
    stderr: isError ? event.detail ?? event.message : event.detail ?? "",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 0,
    timeoutMs: 0,
    timedOut: false,
    signal: null
  });
}

export function summarizeOperationStats(operations: OperationRecord[]): OperationStats {
  const durations = operations
    .map((operation) => operation.durationMs)
    .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration))
    .sort((left, right) => left - right);
  const errors = operations.filter((operation) => operation.status === "error");

  return {
    success: operations.filter((operation) => operation.status === "success").length,
    error: errors.length,
    timedOut: operations.filter((operation) => operation.timedOut).length,
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length)
      : 0,
    p95DurationMs: percentile(durations, 95),
    slowestDurationMs: durations.at(-1) ?? 0,
    lastFailureAt: errors[0]?.finishedAt ?? null
  };
}

export function diagnosticEventFromBody(body: unknown): DiagnosticEventInput {
  const payload = body as Partial<DiagnosticEventInput> | null;
  if (!payload || typeof payload !== "object") {
    throw new Error("Evento de diagnóstico inválido.");
  }

  return normalizeDiagnosticEvent(payload);
}

function normalizeDiagnosticEvent(input: Partial<DiagnosticEventInput>): DiagnosticEventInput {
  if (input.level !== "info" && input.level !== "warning" && input.level !== "error") {
    throw new Error("Nível de diagnóstico inválido.");
  }

  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new Error("Nome de diagnóstico obrigatório.");
  }

  if (typeof input.message !== "string" || !input.message.trim()) {
    throw new Error("Mensagem de diagnóstico obrigatória.");
  }

  return {
    level: input.level,
    name: input.name.trim().slice(0, 80),
    message: input.message.trim().slice(0, 2_000),
    detail: typeof input.detail === "string" && input.detail.trim() ? input.detail.trim().slice(0, 4_000) : undefined,
    context: isRecord(input.context) ? input.context : undefined
  };
}

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.ceil((percentileValue / 100) * values.length) - 1);
  return values[index];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
