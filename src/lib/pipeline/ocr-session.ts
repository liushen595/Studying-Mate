import { useImportSessionStore } from '../../stores/useImportSessionStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { blobsToAttachments } from './image-prep';
import { runOcrStage, savePaperDraftToDb } from './analyzer';

/**
 * Runs Stage 1 OCR against pending (or all) images in the transient import session,
 * persists the resulting marked text draft to IndexedDB, and switches the session to review mode.
 */
export async function executeOcrSession(options: {
  forceFull: boolean;
  onSuccess?: (returnPath: string) => void;
}): Promise<boolean> {
  const session = useImportSessionStore.getState();
  const { images, rawText, existingPaper, draftPaperId, title, examType, parsingMode } = session;

  if (images.length === 0) return false;
  const pendingImages = images.filter((img) => img.ocrStatus === 'pending');
  const targets = options.forceFull ? images : pendingImages;
  if (targets.length === 0) {
    session.setField('ocrStage', 'review');
    options.onSuccess?.(session.ocrReturnPath);
    return true;
  }

  const settings = useSettingsStore.getState();
  const visionProvider = settings.getVisionProvider();
  const analysisProvider = settings.getAnalysisProvider();

  try {
    const attachments = await blobsToAttachments(targets);
    const doneImageCount = images.length - pendingImages.length;
    const pageOffset = options.forceFull ? 0 : doneImageCount;

    const ocrText = await runOcrStage({
      visionProvider,
      images: attachments,
      batchSize: 2,
      pageOffset,
      totalPageCount: images.length,
    });

    const nextRawText = options.forceFull
      ? ocrText
      : rawText.trim()
        ? `${rawText.trim()}\n\n${ocrText}`
        : ocrText;

    const targetIds = new Set(targets.map((t) => t.id));
    const latest = useImportSessionStore.getState();
    latest.setField('rawText', nextRawText);
    latest.setField('aiPreviewDrafts', null);
    latest.setImages((prev) =>
      prev.map((img) => (targetIds.has(img.id) ? { ...img, ocrStatus: 'done' } : img)),
    );

    const savedPaper = await savePaperDraftToDb({
      paperId: draftPaperId || existingPaper?.id,
      existingPaper,
      title,
      examType,
      sourceMode: existingPaper?.sourceMode || 'image',
      parsingMode,
      rawMarkedText: nextRawText,
      asDraftOnly: !existingPaper,
      providerName: analysisProvider.name,
      modelId: analysisProvider.modelId,
      ocrModelId: visionProvider.modelId,
    });

    const returnPath = existingPaper ? `/import?paperId=${savedPaper.id}` : `/import?draft=${savedPaper.id}`;
    latest.setField('existingPaper', savedPaper);
    latest.setField('draftPaperId', savedPaper.id);
    latest.setField('loadedPaperId', savedPaper.id);
    latest.setField('mode', 'image');
    latest.setField('ocrStage', 'review');
    latest.setField('ocrReturnPath', returnPath);

    options.onSuccess?.(returnPath);
    return true;
  } catch {
    return false;
  }
}
