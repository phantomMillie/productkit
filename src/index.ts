export { ExitCode, CliError, type ExitCodeValue } from './errors.js';
export { VERSION } from './version.js';
export { runCli, buildProgram } from './cli/program.js';
export { runInit, type InitOptions } from './cli/commands/init.js';
export {
  scaffoldWorkspace,
  type ScaffoldResult,
  type ScaffoldOptions,
} from './workspace/scaffold.js';
export {
  buildInitPlan,
  ARTIFACT_DIRS,
  WORKSPACE_DIR,
  type PlanEntry,
} from './workspace/plan.js';
export {
  productConfigSchema,
  parseProductConfig,
  initialConfig,
  CONFIG_SCHEMA_VERSION,
  STAGE_NAMES,
  type ProductConfig,
} from './schema/config.js';
export {
  promptSchema,
  parsePrompt,
  computePromptHash,
  promptIntegrityIssue,
  type Prompt,
  type PromptSpan,
} from './schema/prompt.js';
export {
  clarificationSchema,
  parseClarification,
  stepsContentHash,
  clarificationContentHash,
  stepsContentHashFromYaml,
  computeEntryHash,
  judgeCompletion,
  preConfirmationIssue,
  clarificationStepsIssue,
  type Clarification,
  type ClarificationSteps,
  type InterpretationCheckEntry,
  type CompletionJudgement,
  type CompletionBlockReason,
} from './schema/clarification.js';
export { runIntake, type IntakeOptions } from './cli/commands/intake.js';
export { runClarify, type ClarifyOptions } from './cli/commands/clarify.js';
export {
  nodeSchema,
  nodeGroupSchema,
  parseNodeGroup,
  nodeSetContentHash,
  evaluateAtomicityFinal,
  computeStructuralSignal,
  computeLexicalOverlapRatio,
  originMatchesSourceRefs,
  judgeNodeSetCompletion,
  BLOCKING_FINDING_TYPES,
  ADDITION_SUSPECT_THRESHOLD,
  type Node,
  type NodeGroup,
  type Atomicity,
  type NodeFindingCandidate,
  type DistortionCheck,
  type NodeGroupJudgement,
  type NodeGroupBlockReason,
} from './schema/node.js';
export { runModel, type ModelOptions } from './cli/commands/model.js';
export { registerGraphCommand, runGraphValidate, runGraphImpact, runGraphTrace, runGraphCandidateAdd, runGraphCandidateList, runGraphEdgeAdd, runGraphEdgeConfirm } from './cli/commands/graph.js';
export { registerMigrateCommand, runMigrate } from './cli/commands/migrate.js';
export { migrateWorkspace, type MigrationOptions, type MigrationResult } from './clarification/migration.js';
export { loadGraphWorkspace, graphNodeSnapshotHash, type GraphWorkspaceSnapshot, type GraphNodeRecord } from './clarification/provenance.js';
export { computeImpactReport, effectiveEdge, validateGraph, validateConfirmation, canonicalizeEdgeEndpoints } from './clarification/graph.js';
export { addRelationCandidate, readRelationCandidates, reviewRelationCandidate, readGraphDocument, writeGraphDocument } from './clarification/graph-store.js';
export {
  LEGACY_CONFIG_SCHEMA_VERSION,
  LEGACY_STAGE_NAMES,
  productConfigV0Schema,
  productConfigV1Schema,
  initialLegacyConfig,
} from './schema/config.js';
export {
  graphRelationTypeSchema,
  graphEdgeSchema,
  graphDocumentSchema,
  relationCandidateSchema,
  createRelationCandidate,
  relationCandidateFingerprint,
  parseGraphDocument,
  parseRelationCandidate,
  graphEdgeClaimHash,
  confirmationEntryHash,
  candidateReviewEntryHash,
  relationKindAllowed,
  GRAPH_RULES_VERSION,
  type GraphRelationType,
  type GraphEdge,
  type GraphDocument,
  type RelationCandidate,
  type EdgeConfirmation,
} from './schema/graph.js';
export { impactReportSchema, parseImpactReport, type ImpactReport } from './schema/impact.js';
export { registerChallengeCommand } from './cli/commands/challenge.js';
export { addFinding, confirmFinding, readFindings, validateFindingReferences } from './clarification/finding-store.js';
export { currentChallengeInputs, createChallengeRun, readChallengeRuns, refreshChallengeRun, updateChallengeRun, validateChallengeRunReferences } from './clarification/challenge-store.js';
export { findingSchema, findingInputSchema, createFinding, appendFindingConfirmation, findingFingerprint, parseFinding, type Finding, type FindingInput } from './schema/finding.js';
export { challengeRunSchema, challengeAreaSchema, challengeAreas, judgeChallengeCompletion, type ChallengeRun } from './schema/challenge.js';
