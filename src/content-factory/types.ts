export type PublishMode = "dry-run" | "draft" | "publish";

export interface AgentOrchestrationStage {
  id: string;
  order: number;
}

export interface AgentOrchestrationConfig {
  stages: AgentOrchestrationStage[];
}

export interface ContentIndexEntry {
  runId?: string;
  primaryKeyword?: string;
  slug?: string;
  title?: string;
  bodyText?: string;
  textHash?: string;
  createdAt?: string;
}

export interface ContentIndex {
  version: number;
  entries: ContentIndexEntry[];
}

export interface HandoffStageState {
  status: "pending" | "in_progress" | "done" | "failed";
  updatedAt: string;
  note?: string;
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
