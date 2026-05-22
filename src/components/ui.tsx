import type { ReactNode } from "react";

import type { SubAgentStatus } from "../ui-contracts";

type StatusKind = "running" | "success" | "error" | "warn" | "idle";

const SUB_AGENT_STATUS_MAP: Record<SubAgentStatus, { kind: StatusKind; label: string }> = {
  running: { kind: "running", label: "running" },
  requires_input: { kind: "warn", label: "approval" },
  success: { kind: "success", label: "success" },
  error: { kind: "error", label: "error" },
  timeout: { kind: "warn", label: "timeout" },
  cancelled: { kind: "idle", label: "cancelled" },
};

function StatusPillBase({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  return (
    <span className={`pill pill--${kind}`}>
      <span className="pill__dot" />
      {children}
    </span>
  );
}

export function SubAgentStatusPill({ status }: { status: SubAgentStatus }) {
  const cfg = SUB_AGENT_STATUS_MAP[status];
  return <StatusPillBase kind={cfg.kind}>{cfg.label}</StatusPillBase>;
}

export function formatNumber(n: number): string {
  if (n >= 10000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return n.toLocaleString();
}
