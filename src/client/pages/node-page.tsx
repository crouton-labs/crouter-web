/**
 * Node session shell (spec §5.C/D/E/F/H). Owns the session store for one node,
 * connects on mount and disposes on cleanup, and assembles the chrome bar,
 * presence, the input box (prompt vs steer vs disabled-for-observer), the
 * command palette, the message list (from Worker R), and the extension dialog.
 * Orchestrates the dormant→live transition: a static source shows read-only +
 * Revive, and the live snapshot arrives over the SAME socket on revive (no page
 * reload). broker_status down/reconnecting freezes input.
 */

import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { Command, NodeDetail, ThinkingLevel } from '../../shared/protocol.js';
import { closeNode, getCommands, getNode, messageNode, reviveNode, RestError } from '../api/rest.js';
import { createSessionStore } from '../store/session-store.js';
import { ChromeBar } from '../chrome/chrome-bar.js';
import { Presence } from '../chrome/presence.js';
import { CommandPalette } from '../command-palette/palette.js';
import { ExtensionDialog } from '../dialogs/extension-dialog.js';
import { MessageList } from '../session/message-list.js';
import { navigate, setServerReachable } from '../app-routes.js';

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export function NodePage(props: { id: string }): JSX.Element {
  const store = createSessionStore(props.id);
  const [detail, setDetail] = createSignal<NodeDetail | null>(null);
  const [commands, setCommands] = createSignal<Command[]>([]);
  const [input, setInput] = createSignal('');
  const [reviving, setReviving] = createSignal(false);
  const [actionError, setActionError] = createSignal<string | null>(null);

  // --- derived liveness / capability flags ---
  const dormant = () => store.source() === 'static';
  const brokerUp = () => store.brokerStatus() === 'connected' || store.brokerStatus() === 'revived';
  const isController = () => store.role() === 'controller';
  const streaming = () => store.state()?.isStreaming ?? false;
  /** Live driving needs the controller slot on a live, up broker AND a live
   * server bridge. */
  const canDrive = () =>
    isController() && !dormant() && brokerUp() && store.serverConnected();

  // Surface the server-bridge connectivity to the global reconnecting banner
  // (a server restart drops this socket; m2 — distinct from broker-down).
  createEffect(() => setServerReachable(store.serverConnected()));

  const loadCommands = async (): Promise<void> => {
    try {
      setCommands(await getCommands(props.id));
    } catch {
      setCommands([]); // no live command source (dormant) — palette stays empty
    }
  };

  onMount(async () => {
    store.connect();
    try {
      setDetail(await getNode(props.id));
    } catch (err) {
      setActionError(asMessage(err));
    }
    void loadCommands();
  });
  onCleanup(() => store.dispose());

  // --- input actions ---
  const sendPrimary = (): void => {
    const text = input().trim();
    if (!text || !canDrive()) return;
    // While the engine streams, a controller's input steers the live turn (D.6);
    // otherwise it starts a new prompt. Slash commands ride the prompt path (E.4).
    if (streaming()) store.steer(text);
    else store.prompt(text);
    setInput('');
  };

  const onInputKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrimary();
    }
  };

  const selectCommand = (cmd: Command): void => {
    setInput(`/${cmd.name} `);
  };

  // --- lifecycle actions ---
  const doRevive = async (): Promise<void> => {
    setReviving(true);
    setActionError(null);
    try {
      await reviveNode(props.id);
      // The server brings the broker up and pushes broker_status:'revived' + a
      // live snapshot over the existing socket — no reload, same render path.
      void loadCommands();
    } catch (err) {
      setActionError(asMessage(err));
    } finally {
      setReviving(false);
    }
  };

  const doClose = async (): Promise<void> => {
    setActionError(null);
    try {
      await closeNode(props.id);
    } catch (err) {
      setActionError(asMessage(err));
    }
  };

  return (
    <div class="node-page">
      <header class="node-header">
        <button class="btn-link" onClick={() => navigate('/')}>
          ← canvas
        </button>
        <ChromeBar store={store} detail={detail} />
        <Presence store={store} />
      </header>

      <BrokerBanner state={store.brokerStatus()} dormant={dormant()} />
      <Show when={store.error()}>
        {(e) => <div class="ws-error">{e().code}: {e().message}</div>}
      </Show>
      <Show when={actionError()}>
        {(msg) => <div class="ws-error">{msg()}</div>}
      </Show>

      <main class="node-stream">
        <MessageList messages={store.messages} streaming={() => streaming()} />
      </main>

      <Show
        when={!dormant()}
        fallback={
          <DormantBar id={props.id} reviving={reviving()} onRevive={doRevive} onClose={doClose} />
        }
      >
        <DriveToolbar store={store} canDrive={canDrive()} streaming={streaming()} onClose={doClose} />
        <div class="input-area">
          <CommandPalette
            commands={commands}
            query={input}
            visible={() => input().startsWith('/')}
            onSelect={selectCommand}
          />
          <textarea
            class="prompt-input"
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onInputKeyDown}
            disabled={!canDrive()}
            placeholder={inputPlaceholder(isController(), brokerUp())}
            rows={3}
          />
          <div class="input-actions">
            <InboxMessageButton id={props.id} />
            <button class="btn-primary" onClick={sendPrimary} disabled={!canDrive() || !input().trim()}>
              {streaming() ? 'Steer' : 'Send'}
            </button>
          </div>
        </div>
      </Show>

      <ExtensionDialog store={store} />
    </div>
  );
}

function inputPlaceholder(controller: boolean, brokerUp: boolean): string {
  if (!controller) return 'observer — request control to drive this session';
  if (!brokerUp) return 'broker is down — input is frozen';
  return 'Type a prompt, or / for commands…';
}

function BrokerBanner(props: { state: string; dormant: boolean }): JSX.Element {
  return (
    <Show when={!props.dormant && (props.state === 'down' || props.state === 'reconnecting')}>
      <div class="broker-banner" classList={{ down: props.state === 'down' }}>
        {props.state === 'down'
          ? 'Broker is down — history frozen, input disabled. Waiting for auto-revive…'
          : 'Reconnecting to the broker…'}
      </div>
    </Show>
  );
}

function DriveToolbar(props: {
  store: ReturnType<typeof createSessionStore>;
  canDrive: boolean;
  streaming: boolean;
  onClose: () => void;
}): JSX.Element {
  // Reflect the engine's live thinking level (from snapshot/state); an
  // optimistic local override shows the user's pick immediately (m4).
  const [override, setOverride] = createSignal<ThinkingLevel | null>(null);
  const thinking = (): ThinkingLevel =>
    override() ?? props.store.state()?.thinkingLevel ?? 'medium';
  return (
    <div class="drive-toolbar">
      <button class="btn-secondary" disabled={!props.canDrive || !props.streaming} onClick={() => props.store.abort()}>
        Abort
      </button>
      <button class="btn-secondary" disabled={!props.canDrive} onClick={() => props.store.cycleModel()}>
        Cycle model
      </button>
      <label class="toolbar-field">
        thinking
        <select
          disabled={!props.canDrive}
          value={thinking()}
          onChange={(e) => {
            const level = e.currentTarget.value as ThinkingLevel;
            setOverride(level);
            props.store.setThinkingLevel(level);
          }}
        >
          {THINKING_LEVELS.map((l) => (
            <option value={l}>{l}</option>
          ))}
        </select>
      </label>
      <button class="btn-secondary" disabled={!props.canDrive} onClick={() => props.store.compact()}>
        Compact
      </button>
      <button class="btn-danger" onClick={props.onClose}>
        Close node
      </button>
    </div>
  );
}

function DormantBar(props: {
  id: string;
  reviving: boolean;
  onRevive: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div class="dormant-bar">
      <span class="dormant-note">This node is dormant (read-only). Revive to drive it live.</span>
      <InboxMessageButton id={props.id} />
      <button class="btn-primary" disabled={props.reviving} onClick={props.onRevive}>
        {props.reviving ? 'Reviving…' : 'Revive'}
      </button>
      <button class="btn-danger" onClick={props.onClose}>
        Close node
      </button>
    </div>
  );
}

/** Inbox message form — distinct from the live prompt; works on dormant nodes (G.2). */
function InboxMessageButton(props: { id: string }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <button class="btn-secondary" onClick={() => setOpen(true)}>
        Message (inbox)
      </button>
      <Show when={open()}>
        <InboxMessageDialog id={props.id} onClose={() => setOpen(false)} />
      </Show>
    </>
  );
}

function InboxMessageDialog(props: { id: string; onClose: () => void }): JSX.Element {
  const [body, setBody] = createSignal('');
  const [tier, setTier] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<string | null>(null);

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault();
    if (!body().trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await messageNode(props.id, {
        body: body().trim(),
        ...(tier().trim() ? { tier: tier().trim() } : {}),
      });
      setResult(`delivered=${res.delivered} woke=${res.woke}`);
      setBody('');
    } catch (err) {
      setResult(asMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <form class="modal inbox-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Send an inbox message</h2>
        <p class="inbox-note">A directive deliverable to any node, including a dormant one.</p>
        <textarea value={body()} onInput={(e) => setBody(e.currentTarget.value)} rows={4} required />
        <label>
          tier
          <input value={tier()} onInput={(e) => setTier(e.currentTarget.value)} placeholder="(default)" />
        </label>
        <Show when={result()}>{(r) => <p class="inbox-result">{r()}</p>}</Show>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onClick={props.onClose} disabled={busy()}>
            Close
          </button>
          <button type="submit" class="btn-primary" disabled={busy()}>
            {busy() ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

function asMessage(err: unknown): string {
  return err instanceof RestError ? `${err.code}: ${err.message}` : String(err);
}
