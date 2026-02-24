import {useState, useEffect, useCallback} from 'react';
import llamaService, {
  ModelStatus,
  DownloadProgress,
  CompletionResult,
  CompletionOptions,
} from '../services/LlamaService';

export interface UseLlamaResult {
  status: ModelStatus;
  isReady: boolean;
  downloadProgress: DownloadProgress | null;
  loadProgress: number;
  error: string | null;
  initialize: () => Promise<void>;
  complete: (prompt: string, options?: CompletionOptions) => Promise<CompletionResult>;
  stopCompletion: () => Promise<void>;
  removeLoraAdapters: () => Promise<void>;
  applyLoraAdapters: () => Promise<void>;
}

export function useLlama(autoInitialize = true): UseLlamaResult {
  const [status, setStatus] = useState<ModelStatus>('uninitialized');
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const initialize = useCallback(async () => {
    try {
      setError(null);

      const modelsExist = await llamaService.checkModelsExist();

      if (!modelsExist) {
        setStatus('downloading');
        await llamaService.downloadModels(progress => {
          setDownloadProgress(progress);
        });
      }

      setStatus('loading');
      setDownloadProgress(null);
      await llamaService.loadModel(progress => {
        setLoadProgress(progress);
      });

      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (autoInitialize) {
      initialize();
    }

    return () => {};
  }, [autoInitialize, initialize]);

  const complete = useCallback(
    async (prompt: string, options?: CompletionOptions): Promise<CompletionResult> => {
      if (!llamaService.isReady()) {
        throw new Error('Model not ready');
      }
      return llamaService.complete(prompt, options);
    },
    [],
  );

  const stopCompletion = useCallback(async () => {
    await llamaService.stopCompletion();
  }, []);

  const removeLoraAdapters = useCallback(async () => {
    await llamaService.removeLoraAdapters();
  }, []);

  const applyLoraAdapters = useCallback(async () => {
    await llamaService.applyLoraAdapters();
  }, []);

  return {
    status,
    isReady: status === 'ready',
    downloadProgress,
    loadProgress,
    error,
    initialize,
    complete,
    stopCompletion,
    removeLoraAdapters,
    applyLoraAdapters,
  };
}

export default useLlama;
