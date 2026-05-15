export type PublishMode = "dry-run" | "publish" | "draft";

export interface OrchestrationStage {
  id: string;
  order: number;
  label?: string;
}

export interface AgentOrchestrationConfig {
  version: number;
  stages: OrchestrationStage[];
}

export interface ContentIndexEntry {
  runId?: string;
  title?: string;
  primaryKeyword?: string;
  slug?: string;
  metaDescription?: string;
  createdAt?: string;
}

export interface ContentIndex {
  version: number;
  entries: ContentIndexEntry[];
}

export type StageStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "blocked"
  | "skipped";

export interface StageState {
  status: StageStatus;
  updatedAt: string;
  blocker?: string;
}

export interface HandoffIntake {
  niche: string;
  keywords: string[];
  references: string[];
  articleReferenceUrls: string[];
  visualReferenceImages: string[];
  identityLock: boolean;
  styleReferencePolicy: string;
  region?: string;
  brand?: string;
  targetAudience?: string;
  publishMode: PublishMode;
  assumptions: string[];
}

export interface HandoffDocument {
  runId: string;
  createdAt: string;
  updatedAt: string;
  publishMode: PublishMode;
  intake: HandoffIntake;
  stages: Record<string, StageState>;
  supervisorIteration: number;
  wordpressBridge: {
    mode: string;
    workflowTopicTemplate: string;
    readmePath: string;
    scriptPath: string;
  };
  supervisorChecklist: string[];
}

export type DuplicateDecision = "pass" | "rewrite_angle" | "blocked";

export interface DuplicateEvaluation {
  decision: DuplicateDecision;
  similarity: number;
  matchedEntry?: ContentIndexEntry;
  notes: string[];
}
