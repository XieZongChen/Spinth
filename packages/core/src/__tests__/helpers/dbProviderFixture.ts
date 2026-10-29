import * as Y from 'yjs';

/** dbProvider 系单测共享 fixture（specs/split-large-files §5.3） */

export function writeWidget(doc: Y.Doc, id: string, val: string): void {
  doc.transact(() => {
    const m = new Y.Map();
    m.set('id', id);
    m.set('text', val);
    doc.getArray('widgets').push([m]);
  });
}

export const flush = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));
