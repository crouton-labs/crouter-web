/**
 * Node session shell (spec §5.C/D/E/F/H). Owns the session store for one node,
 * auto-connects via useSessionStore (self-managing), and assembles the chrome
 * bar, presence, the input box (prompt vs steer vs disabled-for-observer), the
 * command palette, the message list, and the extension dialog. Orchestrates the
 * dormant→live transition: a static source shows read-only + Revive, and the
 * live snapshot arrives over the SAME socket on revive (no page reload).
 * broker_status down/reconnecting freezes input.
 */

import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Command, NodeDetail, ThinkingLevel } from '../../shared/protocol.js';
import { closeNode, getCommands, getNode, messageNode, reviveNode, RestError } from '../api/rest.js';
import { useSessionStore } from '../store/session-store.js';
import { ChromeBar } from '../chrome/chrome-bar.js';
import { Presence } from '../chrome/presence.js';
import { CommandPalette } from '../command-palette/palette.js';
import { ExtensionDialog } from '../dialogs/extension-dialog.js';
import { MessageList } from '../session/message-list.js';
import { Button } from '@/components/ui/button.js';
import { Textarea } from '@/components/ui/textarea.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog.js';

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

// ---------------------------------------------------------------------------
// NodePage
// ---------------------------------------------------------------------------

export function NodePage(props: { id: string }) {
  const navigate = useNavigate();
  const store = useSessionStore(props.id);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [input, setInput] = useState('');
  const [reviving, setReviving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // --- derived liveness / capability flags ---
  const dormant = store.source === 'static';
  const brokerUp = store.brokerStatus === 'connected' || store.brokerStatus === 'revived';
  const isController = store.role === 'controller';
  const streaming = store.state?.isStreaming ?? false;
  /** Live driving needs the controller slot on a live, up broker AND a live server bridge. */
  const canDrive = isController && !dormant && brokerUp && store.serverConnected;

  const loadCommands = useCallback(async (): Promise<void> => {
    try {
      setCommands(await getCommands(props.id));
    } catch {
      setCommands([]); // dormant or no command source — palette stays empty
    }
  }, [props.id]);

  useEffect(() => {
    getNode(props.id)
      .then(setDetail)
      .catch((err: unknown) => setActionError(asMessage(err)));
    void loadCommands();
  }, [props.id, loadCommands]);

  // --- input actions ---
  const sendPrimary = (): void => {
    const text = input.trim();
    if (!text || !canDrive) return;
    // While streaming a controller's input steers the live turn (D.6);
    // otherwise it starts a new prompt. Slash commands ride the prompt path (E.4).
    if (streaming) store.steer(text);
    else store.prompt(text);
    setInput('');
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Button variant="link" onClick={() => navigate('/')}>
          ← canvas
        </Button>
        <ChromeBar store={store} detail={detail} />
        <Presence store={store} />
      </header>

      <BrokerBanner state={store.brokerStatus} dormant={dormant} />
      {store.error && (
        <div className="border-b border-destructive/30 bg-destructive/15 px-4 py-2 text-sm text-destructive">
          {store.error.code}: {store.error.message}
        </div>
      )}
      {actionError && (
        <div className="border-b border-destructive/30 bg-destructive/15 px-4 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-auto">
        <MessageList messages={store.messages} streaming={streaming} />
      </main>

      {dormant ? (
        <DormantBar id={props.id} reviving={reviving} onRevive={doRevive} onClose={doClose} />
      ) : (
        <>
          <DriveToolbar store={store} canDrive={canDrive} streaming={streaming} onClose={doClose} />
          <div className="relative flex shrink-0 flex-col gap-2 border-t border-border px-4 py-3">
            <CommandPalette
              commands={commands}
              query={input}
              visible={input.startsWith('/')}
              onSelect={selectCommand}
            />
            <Textarea
              className="resize-none font-mono text-sm"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              onKeyDown={onInputKeyDown}
              disabled={!canDrive}
              placeholder={inputPlaceholder(isController, brokerUp)}
              rows={3}
            />
            <div className="flex items-center justify-end gap-2">
              <InboxMessageButton id={props.id} />
              <Button
                variant="default"
                onClick={sendPrimary}
                disabled={!canDrive || !input.trim()}
              >
                {streaming ? 'Steer' : 'Send'}
              </Button>
            </div>
          </div>
        </>
      )}

      <ExtensionDialog store={store} />
    </div>
  );
}

function inputPlaceholder(controller: boolean, brokerUp: boolean): string {
  if (!controller) return 'observer — request control to drive this session';
  if (!brokerUp) return 'broker is down — input is frozen';
  return 'Type a prompt, or / for commands…';
}

// ---------------------------------------------------------------------------
// BrokerBanner
// ---------------------------------------------------------------------------

function BrokerBanner({ state, dormant }: { state: string; dormant: boolean }) {
  if (dormant || (state !== 'down' && state !== 'reconnecting')) return null;
  return (
    <div
      className={[
        'broker-banner border px-4 py-2 text-sm',
        state === 'down'
          ? 'bg-destructive/15 text-destructive border-destructive/30'
          : 'bg-warning/15 border-warning/30',
      ].join(' ')}
    >
      {state === 'down'
        ? 'Broker is down — history frozen, input disabled. Waiting for auto-revive…'
        : 'Reconnecting to the broker…'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DriveToolbar
// ---------------------------------------------------------------------------

function DriveToolbar({
  store,
  canDrive,
  streaming,
  onClose,
}: {
  store: ReturnType<typeof useSessionStore>;
  canDrive: boolean;
  streaming: boolean;
  onClose: () => void;
}) {
  // Reflect the engine's live thinking level; an optimistic local override
  // shows the user's pick immediately (m4).
  const [override, setOverride] = useState<ThinkingLevel | null>(null);
  const thinking: ThinkingLevel = override ?? store.state?.thinkingLevel ?? 'medium';

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-2">
      <Button
        variant="secondary"
        disabled={!canDrive || !streaming}
        onClick={() => store.abort()}
      >
        Abort
      </Button>
      <Button variant="secondary" disabled={!canDrive} onClick={() => store.cycleModel()}>
        Cycle model
      </Button>
      <label className="flex items-center gap-1 text-sm">
        thinking
        <Select
          disabled={!canDrive}
          value={thinking}
          onValueChange={(level) => {
            setOverride(level as ThinkingLevel);
            store.setThinkingLevel(level as ThinkingLevel);
          }}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THINKING_LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Button variant="secondary" disabled={!canDrive} onClick={() => store.compact()}>
        Compact
      </Button>
      <Button variant="destructive" onClick={onClose}>
        Close node
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DormantBar
// ---------------------------------------------------------------------------

function DormantBar({
  id,
  reviving,
  onRevive,
  onClose,
}: {
  id: string;
  reviving: boolean;
  onRevive: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
      <span className="text-muted-foreground text-sm">
        This node is dormant (read-only). Revive to drive it live.
      </span>
      <InboxMessageButton id={id} />
      <Button variant="default" disabled={reviving} onClick={onRevive}>
        {reviving ? 'Reviving…' : 'Revive'}
      </Button>
      <Button variant="destructive" onClick={onClose}>
        Close node
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InboxMessageButton + InboxMessageDialog
// ---------------------------------------------------------------------------

/** Inbox message form — distinct from the live prompt; works on dormant nodes (G.2). */
function InboxMessageButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Message (inbox)
      </Button>
      <InboxMessageDialog id={id} open={open} onOpenChange={setOpen} />
    </>
  );
}

function InboxMessageDialog({
  id,
  open,
  onOpenChange,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [body, setBody] = useState('');
  const [tier, setTier] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // M1: this dialog is permanently mounted and Radix-toggled, so reset the form
  // on each open edge — otherwise reopening shows stale body/tier/result.
  useEffect(() => {
    if (open) {
      setBody('');
      setTier('');
      setResult(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await messageNode(id, {
        body: body.trim(),
        ...(tier.trim() ? { tier: tier.trim() } : {}),
      });
      setResult(`delivered=${String(res.delivered)} woke=${String(res.woke)}`);
      setBody('');
    } catch (err) {
      setResult(asMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send an inbox message</DialogTitle>
          <DialogDescription>
            A directive deliverable to any node, including a dormant one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            rows={4}
            required
            placeholder="Message body…"
          />
          <label className="flex flex-col gap-1 text-sm">
            tier
            <input
              className="rounded border bg-transparent px-2 py-1 text-sm"
              value={tier}
              onChange={(e) => setTier(e.currentTarget.value)}
              placeholder="(default)"
            />
          </label>
          {result && <p className="text-muted-foreground text-sm">{result}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Close
            </Button>
            <Button type="submit" variant="default" disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asMessage(err: unknown): string {
  return err instanceof RestError ? `${err.code}: ${err.message}` : String(err);
}
