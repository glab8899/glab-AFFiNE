import { useEnableCloud } from '@affine/core/components/hooks/affine/use-enable-cloud';
import type { Workspace } from '@affine/core/modules/workspace';
import { track } from '@affine/track';
import type { Blocks } from '@blocksuite/affine/store';
import { useCallback } from 'react';

import { ShareMenu } from './share-menu';

type SharePageModalProps = {
  workspace: Workspace;
  page: Blocks;
};

export const SharePageButton = ({ workspace, page }: SharePageModalProps) => {
  const confirmEnableCloud = useEnableCloud();
  const handleOpenShareModal = useCallback((open: boolean) => {
    if (open) {
      track.$.sharePanel.$.open();
    }
  }, []);

  return (
    <ShareMenu
      workspaceMetadata={workspace.meta}
      currentPage={page}
      onEnableAffineCloud={() =>
        confirmEnableCloud(workspace, {
          openPageId: page.id,
        })
      }
      onOpenShareModal={handleOpenShareModal}
    />
  );
};
