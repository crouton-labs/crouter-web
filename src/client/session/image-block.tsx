/**
 * Inline image content block (spec C.7 / AC-8).
 *
 * Renders an `ImageContent` ({ data: base64, mimeType }) as a bounded inline
 * `<img>` via a `data:` URL. The mime type is whitelisted to known image types
 * so a hostile `mimeType` cannot smuggle a `data:text/html` document into the
 * src; the base64 payload itself is inert in an `<img>`.
 */

import type { JSX } from 'solid-js';
import type { ImageContent } from '../../shared/protocol.js';
import { ensureStyles } from './styles.js';

const SAFE_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
]);

export interface ImageBlockProps {
  image: ImageContent;
}

export function ImageBlock(props: ImageBlockProps): JSX.Element {
  ensureStyles();
  const mime = (): string => {
    const m = (props.image.mimeType || '').toLowerCase();
    return SAFE_IMAGE_MIME.has(m) ? m : 'image/png';
  };
  const src = (): string => `data:${mime()};base64,${props.image.data ?? ''}`;
  return <img class="cw-img" src={src()} alt="image content" loading="lazy" decoding="async" />;
}
