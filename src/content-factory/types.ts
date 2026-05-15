export type PublishMode = "dry-run" | "publish" | "draft";

export interface AgentOrchestrationStage {
  id: string;
  order: number;
  label?: string;
}

export interface AgentOrchestrationConfig {
  version: number;
  stages: AgentOrchestrationStage[];
}

export interface ContentIndexEntry {
  runId?: string;
  title?: string;
  slug?: string;
  primaryKeyword?: string;
  metaDescription?: string;
  createdAt?: string;
  url?: string;
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
  intake: {
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
  };
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

export interface DuplicateEvaluationInput {
  runId: string;
  primaryKeyword: string;
  slug: string;
  title: string;
  bodyText: string;
}

export type DuplicateDecision = "pass" | "rewrite_required" | "blocked";

export interface DuplicateReport {
  runId: string;
  decision: DuplicateDecision;
  maxSimilarity: number;
  notes: string[];
  collisions: Array<{
    field: "title" | "slug" | "meta" | "body" | "keyword";
    against?: string;
    similarity?: number;
  }>;
}

export interface IndexNowResult {
  ok: boolean;
  mode: "get" | "post" | "skipped";
  httpStatus: number;
  status: string;
  detail: string;
  actionRequired?: string;
  localKeyFileRelative?: string;
  expectedPublicUrlMasked?: string;
  keyMasked?: string;
}
