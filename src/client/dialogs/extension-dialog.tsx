/**
 * Blocking extension UI dialog (spec §5.H). Renders the modal extension request
 * from the session store (`select`/`confirm`/`input`/`editor`/`notify`) and
 * sends the controller's answer back via `store.dialogResponse`. An observer
 * (role !== 'controller') sees a read-only "the controller is being prompted"
 * state and cannot answer (H.2). The non-modal methods
 * (setStatus/setWidget/setTitle/set_editor_text) are NOT handled here — the
 * server routes those into chrome / the input field — so this component renders
 * nothing for them.
 */

import { createSignal, For, Show, type JSX } from 'solid-js';
import type { RpcExtensionUIRequest } from '../../shared/protocol.js';
import type { SessionStore } from '../store/session-store.js';

type ModalRequest = Extract<
  RpcExtensionUIRequest,
  { method: 'select' | 'confirm' | 'input' | 'editor' | 'notify' }
>;

const MODAL_METHODS = new Set(['select', 'confirm', 'input', 'editor', 'notify']);

function isModal(req: RpcExtensionUIRequest): req is ModalRequest {
  return MODAL_METHODS.has(req.method);
}

export function ExtensionDialog(props: { store: SessionStore }): JSX.Element {
  const modal = (): ModalRequest | null => {
    const d = props.store.dialog();
    return d && isModal(d) ? d : null;
  };
  const canAnswer = () => props.store.role() === 'controller';

  return (
    <Show when={modal()} keyed>
      {(req) => (
        <div class="modal-backdrop">
          <div class="modal extension-dialog" classList={{ readonly: !canAnswer() }}>
            <Show
              when={canAnswer()}
              fallback={<ObserverNotice req={req} />}
            >
              <DialogBody req={req} store={props.store} />
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

function ObserverNotice(props: { req: ModalRequest }): JSX.Element {
  return (
    <div class="dialog-observer">
      <p class="dialog-observer-title">The controller is being prompted</p>
      <p class="dialog-observer-detail">{describeRequest(props.req)}</p>
    </div>
  );
}

function describeRequest(req: ModalRequest): string {
  switch (req.method) {
    case 'select':
      return `${req.title} — ${req.options.length} options`;
    case 'confirm':
      return `${req.title}: ${req.message}`;
    case 'input':
      return req.title;
    case 'editor':
      return req.title;
    case 'notify':
      return req.message;
  }
}

function DialogBody(props: { req: ModalRequest; store: SessionStore }): JSX.Element {
  const cancel = (): void => props.store.dialogResponse(props.req.id, { cancelled: true });

  return (
    <Show when={props.req.method === 'select'} fallback={<NonSelect req={props.req} store={props.store} cancel={cancel} />}>
      <SelectDialog req={props.req as Extract<ModalRequest, { method: 'select' }>} store={props.store} cancel={cancel} />
    </Show>
  );
}

function SelectDialog(props: {
  req: Extract<ModalRequest, { method: 'select' }>;
  store: SessionStore;
  cancel: () => void;
}): JSX.Element {
  return (
    <>
      <h2>{props.req.title}</h2>
      <ul class="dialog-options">
        <For each={props.req.options}>
          {(opt) => (
            <li>
              <button
                class="btn-secondary"
                onClick={() => props.store.dialogResponse(props.req.id, { value: opt })}
              >
                {opt}
              </button>
            </li>
          )}
        </For>
      </ul>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" onClick={props.cancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function NonSelect(props: {
  req: ModalRequest;
  store: SessionStore;
  cancel: () => void;
}): JSX.Element {
  const [text, setText] = createSignal(
    props.req.method === 'editor' ? props.req.prefill ?? '' : '',
  );

  return (
    <>
      <Show when={props.req.method === 'confirm'}>
        {(() => {
          const r = props.req as Extract<ModalRequest, { method: 'confirm' }>;
          return (
            <>
              <h2>{r.title}</h2>
              <p class="dialog-message">{r.message}</p>
              <div class="modal-actions">
                <button class="btn-secondary" onClick={() => props.store.dialogResponse(r.id, { confirmed: false })}>
                  No
                </button>
                <button class="btn-primary" onClick={() => props.store.dialogResponse(r.id, { confirmed: true })}>
                  Yes
                </button>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={props.req.method === 'input' || props.req.method === 'editor'}>
        {(() => {
          const r = props.req as Extract<ModalRequest, { method: 'input' | 'editor' }>;
          return (
            <>
              <h2>{r.title}</h2>
              <Show
                when={r.method === 'editor'}
                fallback={
                  <input
                    class="dialog-input"
                    placeholder={r.method === 'input' ? r.placeholder ?? '' : ''}
                    value={text()}
                    onInput={(e) => setText(e.currentTarget.value)}
                    autofocus
                  />
                }
              >
                <textarea
                  class="dialog-editor"
                  rows={8}
                  value={text()}
                  onInput={(e) => setText(e.currentTarget.value)}
                  autofocus
                />
              </Show>
              <div class="modal-actions">
                <button type="button" class="btn-secondary" onClick={props.cancel}>
                  Cancel
                </button>
                <button class="btn-primary" onClick={() => props.store.dialogResponse(r.id, { value: text() })}>
                  Submit
                </button>
              </div>
            </>
          );
        })()}
      </Show>

      <Show when={props.req.method === 'notify'}>
        {(() => {
          const r = props.req as Extract<ModalRequest, { method: 'notify' }>;
          return (
            <>
              <p class={`dialog-notify notify-${r.notifyType ?? 'info'}`}>{r.message}</p>
              <div class="modal-actions">
                <button class="btn-primary" onClick={() => props.store.dialogResponse(r.id, { confirmed: true })}>
                  OK
                </button>
              </div>
            </>
          );
        })()}
      </Show>
    </>
  );
}
