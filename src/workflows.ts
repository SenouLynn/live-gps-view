/**
 * Entry workflows. The startup screen renders from this registry, so a new
 * workflow or integration is one descriptor plus, optionally, a settings form
 * in index.html marked `data-workflow-settings="<id>"`.
 *
 * TODO workflows and paths are shown so the full map stays visible, but
 * they cannot be selected until their status is 'available'.
 */
export type Availability = 'available' | 'todo';
export interface WorkflowPath { id: string; label: string; status: Availability }
export interface WorkflowDescriptor {
  id: string;
  status: Availability;
  /** Card and sidebar title. */
  title: string;
  /** Integration or data source that drives the workspace. */
  source: string;
  /** Three short nouns, same shape on every card. */
  summary: string;
  /** Branches inside the workflow, in the order they should be offered. */
  paths: readonly WorkflowPath[];
  /** What opening the workspace does. */
  brief: string;
  /** Primary action label. */
  action: string;
}

export const workflows = [
  {
    id: 'live', status: 'available', title: 'Live', source: 'YALB-GCS',
    summary: 'Telemetry, Vehicle Discovery, Auto-Reconnect',
    paths: [{ id: 'yalb-bridge', label: 'YALB-GCS Bridge', status: 'available' }],
    brief: 'Connects through the configured local bridge. Discovered vehicles appear automatically; a dropped stream reconnects while the camera holds its last pose.',
    action: 'Connect',
  },
  {
    id: 'demo', status: 'available', title: 'Validation', source: 'Replay',
    summary: 'Tests, Blackbox Replay, SITL',
    paths: [
      { id: 'demo-replay', label: 'Demo Replay', status: 'available' },
      { id: 'tests', label: 'Tests', status: 'todo' },
      { id: 'blackbox', label: 'Blackbox Replay', status: 'todo' },
      { id: 'sitl', label: 'SITL', status: 'todo' },
    ],
    brief: 'Replay the figure eight or choose a repeatable physics validation scenario: trim, power, right-bank control, or terrain contact and reset.',
    action: 'Start replay',
  },
  {
    id: 'sandbox', status: 'available', title: 'Sandbox', source: 'Keyboard',
    summary: 'Simple Free Flight or C172 Physics Engine',
    paths: [{ id: 'keyboard-flight', label: 'Simple Free Flight', status: 'available' },
      { id: 'physics-flight', label: 'Physics Engine', status: 'available' }],
    brief: 'Simple Free Flight resumes your saved flight. Physics Engine auto-loads a C172 at 100 kt, trimmed at your starting position; reload begins a new flight.',
    action: 'Start flight',
  },
] as const satisfies readonly WorkflowDescriptor[];

export type Workflow = typeof workflows[number]['id'];
/** Workflows a saved session may restore; TODO ones fall back to setup defaults. */
export const workflowIds: readonly string[] = workflows.filter(workflow => workflow.status === 'available').map(workflow => workflow.id);
export const workflowById = (id: Workflow): WorkflowDescriptor => workflows.find(workflow => workflow.id === id)!;
