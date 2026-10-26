import { useRef, useCallback, useState } from 'react';
import { color, radius, font } from './tokens.js';
import { t } from '../i18n/index.js';

const MAX_SIZE = 512 * 1024; // 512KB — resize if larger

function resizeImage(dataUrl: string, maxWidth: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= maxWidth) {
        resolve(dataUrl);
        return;
      }
      const ratio = maxWidth / img.width;
      const canvas = document.createElement('canvas');
      canvas.width = maxWidth;
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = dataUrl;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processImage(file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  if (dataUrl.length > MAX_SIZE) {
    return resizeImage(dataUrl, 800);
  }
  return dataUrl;
}

/**
 * Hook for handling image paste and file upload.
 * Supports multiple images — each call to onChange adds one.
 */
export function useImageInput(onAdd: (dataUrl: string, filename?: string) => void) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return;

    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    const dataUrl = await processImage(file);
    onAdd(dataUrl, file.name || undefined);
  }, [onAdd]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const dataUrl = await processImage(file);
    onAdd(dataUrl, file.name || undefined);
    if (fileRef.current) fileRef.current.value = '';
  }, [onAdd]);

  const openFilePicker = useCallback(() => {
    fileRef.current?.click();
  }, []);

  return { handlePaste, handleFileChange, openFilePicker, fileRef };
}

// ── Inline attachment badges ────────────────────────────────────────────────

function AttachmentBadge({ src, onRemove }: { src: string; onRemove: () => void }) {
  const [hover, setHover] = useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Thumbnail */}
      <img
        src={src}
        alt=""
        style={{
          width: 32, height: 32, borderRadius: radius.sm,
          objectFit: 'cover', display: 'block',
          border: `1px solid ${color.border}`,
        }}
      />
      {/* Remove button — visible on hover */}
      {hover && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: -4, right: -4,
            width: 14, height: 14, borderRadius: '50%',
            backgroundColor: '#ef4444', color: '#fff',
            border: 'none', cursor: 'pointer',
            fontSize: 8, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ×
        </button>
      )}
      {/* Hover preview */}
      {hover && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: color.popover, border: `1px solid ${color.border}`,
          borderRadius: radius.md, padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 10,
        }}>
          <img
            src={src}
            alt=""
            style={{ maxWidth: 200, maxHeight: 150, borderRadius: radius.sm, display: 'block' }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Inline attachment row — compact badges with hover preview.
 * Shows existing images + an add button.
 */
export function InlineAttachments({
  images,
  onAdd,
  onRemove,
  fileRef,
  onFileChange,
  onComponent,
}: {
  images: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** With it, + is a menu: an image, or a component from the catalog */
  onComponent?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
      marginTop: 6,
    }}>
      {images.map((src, i) => (
        <AttachmentBadge key={i} src={src} onRemove={() => onRemove(i)} />
      ))}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={(e) => { e.stopPropagation(); if (onComponent) setMenu(m => !m); else onAdd(); }}
        style={{
          width: 32, height: 32, borderRadius: radius.sm,
          border: `1px dashed ${color.border}`, background: 'none',
          cursor: 'pointer', color: color.mutedForeground,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, lineHeight: 1,
        }}
      >
        +
      </button>
      {menu && onComponent && (
        <div
          role="menu"
          onMouseLeave={() => setMenu(false)}
          style={{
            position: 'absolute', bottom: 36, left: 0, zIndex: 2, minWidth: 140, padding: 4,
            background: color.popover, border: `1px solid ${color.border}`, borderRadius: radius.md, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}
        >
          {[
            { label: t('card.addImage'), run: onAdd },
            { label: t('card.addComponent'), run: onComponent },
          ].map(item => (
            <button
              key={item.label}
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); setMenu(false); item.run(); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', borderRadius: radius.sm,
                background: 'none', cursor: 'pointer', fontSize: 12, color: color.foreground,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      </span>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} style={{ display: 'none' }} />
    </div>
  );
}
