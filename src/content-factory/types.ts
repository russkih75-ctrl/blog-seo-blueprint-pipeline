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
}

export interface ContentIndex {
  version: number;
  entries: ContentIndexEntry[];
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
  stages: Record<
    string,
    { status: string; updatedAt: string; notes?: string }
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

export interface StyleTemplateConfig {
  version: number;
  referenceSites?: string[];
  referenceUsage?: string;
  factualSource?: boolean;
  visualReferencePolicy?: string;
  averageLengthPolicy?: string;
  notes?: string;
  requiredSections?: { id: string; role: string }[];
  tone?: Record<string, unknown>;
}
