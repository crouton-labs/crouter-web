/**
 * Canvas overview (spec §5.B). Renders the `subscribes_to` parent/child forest
 * from the canvas store with a distinct visual treatment per lifecycle status
 * and a blocked-on-human flag (attention_count > 0). Non-enterable nodes
 * (host_kind !== 'broker') are shown but marked with a reason and do not
 * navigate; enterable nodes navigate to /nodes/:id. A "Spawn a node" action
 * (B.7/G.1) posts to rest.spawnNode — the new node arrives via the canvas stream.
 */

import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { NodeMode, NodeSummary, SpawnRequest } from '../../shared/protocol.js';
import { RestError, spawnNode } from '../api/rest.js';
import { createCanvasStore, type ForestNode } from '../store/canvas-store.js';
import { navigate, setServerReachable } from '../app-routes.js';

const NON_ENTERABLE_REASON = 'hosted in a tmux pane — open it in your terminal';

export function CanvasPage(): JSX.Element {
  const store = createCanvasStore({ onConnectivity: setServerReachable });
  const [spawnOpen, setSpawnOpen] = createSignal(false);

  onMount(() => store.connect());
  onCleanup(() => store.dispose());

  return (
    <div class="canvas-page">
      <header class="canvas-header">
        <h1>Canvas</h1>
        <div class="canvas-header-actions">
          <Show when={store.generatedAt()}>
            {(at) => <span class="canvas-generated">updated {fmtTime(at())}</span>}
          </Show>
          <button class="btn-primary" onClick={() => setSpawnOpen(true)}>
            Spawn a node
          </button>
        </div>
      </header>

      <Show
        when={store.forest().length > 0}
        fallback={<p class="canvas-empty">No nodes on the canvas yet.</p>}
      >
        <ul class="forest">
          <For each={store.forest()}>{(fn) => <ForestRow node={fn} depth={0} />}</For>
        </ul>
      </Show>

      <Show when={spawnOpen()}>
        <SpawnDialog onClose={() => setSpawnOpen(false)} />
      </Show>
    </div>
  );
}

function ForestRow(props: { node: ForestNode; depth: number }): JSX.Element {
  const node = () => props.node.node;
  const enterable = () => node().enterable;

  const activate = (): void => {
    if (enterable()) navigate(`/nodes/${encodeURIComponent(node().node_id)}`);
  };

  return (
    <li class="forest-item">
      <div
        class="node-card"
        classList={{
          [`status-${node().status}`]: true,
          'blocked-human': node().attention_count > 0,
          enterable: enterable(),
          'non-enterable': !enterable(),
        }}
        style={{ 'margin-left': `${props.depth * 1.25}rem` }}
        onClick={activate}
        role={enterable() ? 'button' : undefined}
        tabindex={enterable() ? 0 : undefined}
        onKeyDown={(e) => {
          if (enterable() && (e.key === 'Enter' || e.key === ' ')) activate();
        }}
      >
        <div class="node-card-main">
          <span class="node-name">{node().name}</span>
          <span class="node-kind">{node().kind}</span>
          <StatusBadge node={node()} />
        </div>
        <div class="node-card-meta">
          <span class="node-mode">{node().mode}</span>
          <span class="node-lifecycle">{node().lifecycle}</span>
          <span class="node-cwd" title={node().cwd}>
            {node().cwd}
          </span>
        </div>
        <Show when={node().attention_count > 0}>
          <span class="attention-flag" title="blocked on a human ask">
            ⚑ {node().attention_count} waiting on human
          </span>
        </Show>
        <Show when={!enterable()}>
          <span class="non-enterable-reason">{NON_ENTERABLE_REASON}</span>
        </Show>
      </div>
      <Show when={props.node.children.length > 0}>
        <ul class="forest">
          <For each={props.node.children}>
            {(child) => <ForestRow node={child} depth={props.depth + 1} />}
          </For>
        </ul>
      </Show>
    </li>
  );
}

function StatusBadge(props: { node: NodeSummary }): JSX.Element {
  return (
    <span class={`status-badge status-${props.node.status}`}>{props.node.status}</span>
  );
}

// --- spawn dialog (B.7 / G.1) ----------------------------------------------

function SpawnDialog(props: { onClose: () => void }): JSX.Element {
  const [prompt, setPrompt] = createSignal('');
  const [kind, setKind] = createSignal('developer');
  const [mode, setMode] = createSignal<NodeMode | ''>('');
  const [root, setRoot] = createSignal(false);
  const [cwd, setCwd] = createSignal('');
  const [name, setName] = createSignal('');
  const [model, setModel] = createSignal('');
  const [parent, setParent] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (!prompt().trim() || !kind().trim()) {
      setError('prompt and kind are required');
      return;
    }
    setBusy(true);
    setError(null);
    const req: SpawnRequest = {
      prompt: prompt().trim(),
      kind: kind().trim(),
      ...(mode() ? { mode: mode() as NodeMode } : {}),
      ...(root() ? { root: true } : {}),
      ...(cwd().trim() ? { cwd: cwd().trim() } : {}),
      ...(name().trim() ? { name: name().trim() } : {}),
      ...(model().trim() ? { model: model().trim() } : {}),
      ...(parent().trim() ? { parent: parent().trim() } : {}),
    };
    try {
      await spawnNode(req);
      props.onClose(); // the node surfaces via the canvas stream
    } catch (err) {
      setError(err instanceof RestError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <form class="modal spawn-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Spawn a node</h2>
        <label>
          Prompt
          <textarea
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            rows={4}
            required
          />
        </label>
        <label>
          Kind
          <input value={kind()} onInput={(e) => setKind(e.currentTarget.value)} required />
        </label>
        <label>
          Mode
          <select value={mode()} onChange={(e) => setMode(e.currentTarget.value as NodeMode | '')}>
            <option value="">(default)</option>
            <option value="base">base</option>
            <option value="orchestrator">orchestrator</option>
          </select>
        </label>
        <label class="checkbox">
          <input type="checkbox" checked={root()} onChange={(e) => setRoot(e.currentTarget.checked)} />
          Resident root node
        </label>
        <label>
          cwd
          <input value={cwd()} onInput={(e) => setCwd(e.currentTarget.value)} placeholder="(inherit)" />
        </label>
        <label>
          Name
          <input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="(auto)" />
        </label>
        <label>
          Model
          <input value={model()} onInput={(e) => setModel(e.currentTarget.value)} placeholder="(default)" />
        </label>
        <label>
          Parent node id
          <input value={parent()} onInput={(e) => setParent(e.currentTarget.value)} placeholder="(this canvas root)" />
        </label>
        <Show when={error()}>
          {(msg) => <p class="form-error">{msg()}</p>}
        </Show>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onClick={props.onClose} disabled={busy()}>
            Cancel
          </button>
          <button type="submit" class="btn-primary" disabled={busy()}>
            {busy() ? 'Spawning…' : 'Spawn'}
          </button>
        </div>
      </form>
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
