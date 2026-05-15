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
  createdAt?: string;
  title?: string;
  slug?: string;
  primaryKeyword?: string;
  bodySnippet?: string;
  url?: string;
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

export interface HandoffDocument {
  runId: string;
  createdAt: string;
  updatedAt: string;
  publishMode: PublishMode;
  intake: HandoffIntake;
  stages: Record<
    string,
    { status: string; updatedAt: string; note?: string }
  >;
  supervisorIteration: number;
  wordpressBridge: {
    mode: string;
    workflowTopicTemplate: string;
    readmePath: string;
    scriptPath: string;
  };
  supervisorChecklist: string[];
}

export interface IndexNowResultShape {
  ok: boolean;
  mode: string;
  httpStatus: number;
  status: string;
  detail: string;
  actionRequired?: string;
  localKeyFileRelative?: string;
  expectedPublicUrlMasked?: string;
  keyMasked?: string;
}
