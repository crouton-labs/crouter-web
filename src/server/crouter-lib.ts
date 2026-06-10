/**
 * The SOLE module that imports `@crouton-kit/crouter` (design D1).
 *
 * Every other server module imports the sanctioned crouter surface from HERE,
 * never from the package directly. This isolates the dependency to one seam so
 * it can be mocked in tests (the REST-handler unit tests mock this module) and
 * so a crouter API change ripples through exactly one file.
 *
 * The package root (`@crouton-kit/crouter`) re-exports the sanctioned barrel;
 * deep subpath imports are gated by its `exports` map and must never be used.
 */

// --- Lifecycle + canvas control (sanctioned library APIs) ---
export {
  spawnChild,
  reviveNode,
  closeNode,
  appendInbox,
  getNode,
  listNodes,
  nodeDir,
  asksForNodes,
  asksAcrossCanvas,
  readTelemetry,
  readContextTokens,
} from '@crouton-kit/crouter';

export type {
  SpawnChildOpts,
  SpawnChildResult,
  ReviveResult,
  CloseNodeResult,
  InboxEntry,
  InboxTier,
  InboxKind,
  NodeMeta,
  NodeRow,
  NodeStatus,
  Lifecycle,
  Mode,
  AskEntry,
  Telemetry,
} from '@crouton-kit/crouter';

// --- Broker socket client + frame codec ---
export {
  ViewSocketClient,
  BrokerUnavailableError,
  encodeFrame,
  FrameDecoder,
  FrameOverflowError,
  CLIENT_READ_CAPS,
  BROKER_READ_CAPS,
} from '@crouton-kit/crouter';

// --- Broker protocol frame types + SessionStats ---
export type {
  FrameDecoderCaps,
  BrokerSnapshot,
  ClientRole,
  WelcomeFrame,
  ControlChangedFrame,
  AckFrame,
  ErrorFrame,
  ExtensionUIRequestFrame,
  ExtensionUIResponseFrame,
  BrokerToClient,
  ClientToBroker,
  HelloFrame,
  PromptFrame,
  SteerFrame,
  FollowUpFrame,
  AbortFrame,
  RequestControlFrame,
  ReleaseControlFrame,
  ByeFrame,
  ShutdownFrame,
  SetModelFrame,
  CycleModelFrame,
  SetThinkingLevelFrame,
  SetAutoRetryFrame,
  SetAutoCompactionFrame,
  CompactFrame,
  NewSessionFrame,
  SwitchSessionFrame,
  ForkFrame,
  SetSessionNameFrame,
  GetCommandsFrame,
  NavigateTreeFrame,
  ReloadFrame,
  ExportFrame,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  SessionStats,
} from '@crouton-kit/crouter';
