export type PublishMode = "dry-run" | "publish" | "draft";

export interface OrchestrationStage {
  id: string;
  order: number;
}

export interface AgentOrchestrationConfig {
  version?: number;
  stages: OrchestrationStage[];
}

export interface ContentIndexEntry {
  title?: string;
  slug?: string;
  primaryKeyword?: string;
  bodySnippet?: string;
  runId?: string;
  createdAt?: string;
}

export interface ContentIndex {
  version: number;
  entries: ContentIndexEntry[];
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

export type StageStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "blocked"
  | "skipped";

export interface HandoffStageState {
  status: StageStatus;
  updatedAt: string;
  blocker?: string;
}

export interface HandoffDocument {
  runId: string;
  createdAt: string;
  updatedAt: string;
  publishMode: PublishMode;
  intake: HandoffIntake;
  stages: Record<string, HandoffStageState>;
  supervisorIteration: number;
  wordpressBridge: {
    mode: string;
    workflowTopicTemplate: string;
    readmePath: string;
    scriptPath: string;
  };
  supervisorChecklist: string[];
}

export interface DefaultArticleStyleConfig {
  version: number;
  referenceUsage?: string;
  requiredSections?: { id: string; role: string }[];
  tone?: { year?: number; voice?: string; avoid?: string[] };
  notes?: string;
}
