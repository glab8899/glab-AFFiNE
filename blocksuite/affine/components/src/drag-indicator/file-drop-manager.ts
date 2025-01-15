import {
  calcDropTarget,
  type DropTarget,
  getClosestBlockComponentByPoint,
  isInsidePageEditor,
  matchFlavours,
} from '@blocksuite/affine-shared/utils';
import {
  type BlockComponent,
  type BlockStdScope,
  type EditorHost,
  LifeCycleWatcher,
} from '@blocksuite/block-std';
import { createIdentifier } from '@blocksuite/global/di';
import type { IVec } from '@blocksuite/global/utils';
import { Point, throttle } from '@blocksuite/global/utils';
import type { BlockModel, ExtensionType } from '@blocksuite/store';
import { computed, signal } from '@preact/signals-core';

import type { DragIndicator } from './drag-indicator';

export type DropProps = {
  std: BlockStdScope;
  files: File[];
  targetModel: BlockModel | null;
  placement: 'before' | 'after';
  point: IVec;
};

export type FileDropOptions = {
  flavour: string;
  onDrop?: (props: DropProps) => boolean;
};

/**
 * Handles resources from outside.
 * Uses `drag over` to handle it.
 */
export class FileDropExtension extends LifeCycleWatcher {
  static override readonly key = 'FileDropExtension';

  static get indicator() {
    let indicator = document.querySelector<DragIndicator>(
      'affine-drag-indicator'
    );

    if (!indicator) {
      indicator = document.createElement(
        'affine-drag-indicator'
      ) as DragIndicator;
      document.body.append(indicator);
    }

    return indicator;
  }

  dragging$ = signal(false);

  point$ = signal<Point | null>(null);

  closestElement$ = signal<BlockComponent | null>(null);

  dropTarget$ = computed<DropTarget | null>(() => {
    let target = null;
    const element = this.closestElement$.value;
    if (!element) return target;

    const model = element.model;
    const parent = this.std.store.getParent(model);

    if (!matchFlavours(parent, ['affine:surface' as BlockSuite.Flavour])) {
      const point = this.point$.value;
      target = point && calcDropTarget(point, model, element);
    }

    return target;
  });

  getDropTargetModel(model: BlockModel | null) {
    // Existed or In Edgeless
    if (model || !isInsidePageEditor(this.editorHost)) return model;

    const rootModel = this.doc.root;
    if (!rootModel) return null;

    let lastNote = rootModel.children[rootModel.children.length - 1];
    if (!lastNote || !matchFlavours(lastNote, ['affine:note'])) {
      const newNoteId = this.doc.addBlock('affine:note', {}, rootModel.id);
      const newNote = this.doc.getBlock(newNoteId)?.model;
      if (!newNote) return null;
      lastNote = newNote;
    }

    const lastItem = lastNote.children[lastNote.children.length - 1];
    if (lastItem) {
      model = lastItem;
    } else {
      const newParagraphId = this.doc.addBlock(
        'affine:paragraph',
        {},
        lastNote,
        0
      );
      model = this.doc.getBlock(newParagraphId)?.model ?? null;
    }

    return model;
  }

  shouldIgnoreEvent = (event: DragEvent, shouldCheckFiles?: boolean) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return true;

    const effectAllowed = dataTransfer.effectAllowed;
    if (effectAllowed === 'none') return true;

    if (!shouldCheckFiles) return false;

    const droppedFiles = dataTransfer.files;
    if (!droppedFiles || !droppedFiles.length) return true;

    return false;
  };

  updatePoint = (event: DragEvent) => {
    const { clientX, clientY } = event;
    const oldPoint = this.point$.peek();

    if (
      oldPoint &&
      Math.round(oldPoint.x) === Math.round(clientX) &&
      Math.round(oldPoint.y) === Math.round(clientY)
    )
      return;

    this.point$.value = new Point(clientX, clientY);
  };

  onDragLeave = () => {
    this.point$.value = null;
  };

  onDragOver = (event: DragEvent) => {
    event.preventDefault();

    if (this.shouldIgnoreEvent(event)) return;

    this.updatePoint(event);
  };

  onDrop = (event: DragEvent) => {
    event.preventDefault();

    if (this.shouldIgnoreEvent(event, true)) return;

    this.updatePoint(event);
  };

  get doc() {
    return this.std.store;
  }

  get editorHost(): EditorHost {
    return this.std.host;
  }

  override mounted() {
    super.mounted();
    const std = this.std;

    std.event.disposables.add(
      this.point$.subscribe(
        throttle(
          value => {
            if (!value) {
              this.closestElement$.value = null;
              return;
            }

            const element = getClosestBlockComponentByPoint(value);
            if (!element) {
              return;
            }

            if (element === this.closestElement$.value) {
              return;
            }

            this.closestElement$.value = element;
          },
          144,
          { leading: true, trailing: true }
        )
      )
    );

    std.event.disposables.add(
      this.dropTarget$.subscribe(target => {
        FileDropExtension.indicator.rect = target?.rect ?? null;
      })
    );

    std.event.disposables.add(
      std.event.add('nativeDragStart', () => {
        this.dragging$.value = true;
      })
    );
    std.event.disposables.add(
      std.event.add('nativeDragEnd', () => {
        this.dragging$.value = false;
      })
    );
    std.event.disposables.add(
      std.event.add('nativeDragOver', context => {
        const event = context.get('dndState').raw;

        if (this.dragging$.peek()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        this.onDragOver(event);
      })
    );
    std.event.disposables.add(
      std.event.add('nativeDragLeave', () => {
        this.onDragLeave();
      })
    );
    std.event.disposables.add(
      std.event.add('nativeDrop', context => {
        const event = context.get('dndState').raw;
        const { x, y, dataTransfer } = event;
        const droppedFiles = dataTransfer?.files;

        if (!droppedFiles || !droppedFiles.length) {
          this.onDragLeave();
          return;
        }

        this.onDrop(event);

        const target = this.dropTarget$.peek();
        const std = this.std;
        const targetModel = this.getDropTargetModel(
          target?.modelState.model ?? null
        );
        const placement = target?.placement === 'before' ? 'before' : 'after';

        const values = std.provider
          .getAll(FileDropConfigExtensionIdentifier)
          .values();

        for (const ext of values) {
          if (!ext.onDrop) continue;

          const options = {
            std,
            files: [...droppedFiles],
            targetModel,
            placement,
            point: [x, y],
          } satisfies DropProps;

          if (ext.onDrop(options)) break;
        }

        this.onDragLeave();
      })
    );
  }
}

const FileDropConfigExtensionIdentifier = createIdentifier<FileDropOptions>(
  'FileDropConfigExtension'
);

export const FileDropConfigExtension = (
  options: FileDropOptions
): ExtensionType => {
  const identifier = FileDropConfigExtensionIdentifier(options.flavour);
  return {
    setup: di => {
      di.addImpl(identifier, () => options);
    },
  };
};
