import {initLlama, LlamaContext} from 'llama.rn';
import RNFS from 'react-native-fs';

const LOCALSCRIBE_REPO = 'https://huggingface.co/mrchrisrenton/localscribe-demo/resolve/main';

const MODEL_URL = 'https://huggingface.co/unsloth/medgemma-1.5-4b-it-GGUF/resolve/main/medgemma-1.5-4b-it-Q4_K_M.gguf';
const LORA_URL = `${LOCALSCRIBE_REPO}/medgemma-1.5-4b-annotation-lora-v3.gguf`;
const MEL_URL = `${LOCALSCRIBE_REPO}/medasr_mel_fp32.onnx`;
const ASR_URL = `${LOCALSCRIBE_REPO}/medasr_asr_int8.onnx`;
const TOKENIZER_URL = `${LOCALSCRIBE_REPO}/tokenizer.json`;

const MODEL_FILENAME = 'medgemma-1.5-4b-it-Q4_K_M.gguf';
const LORA_FILENAME = 'medgemma-1.5-4b-annotation-lora-v3.gguf';
const MEL_FILENAME = 'medasr_mel_fp32.onnx';
const ASR_FILENAME = 'medasr_asr_int8.onnx';
const TOKENIZER_FILENAME = 'tokenizer.json';

export type ModelStatus = 'uninitialized' | 'downloading' | 'loading' | 'ready' | 'error';

export interface DownloadProgress {
  file: string;
  progress: number;
}

export interface CompletionResult {
  thinking: string;
  response: string;
  rawText: string;
}

export interface CompletionOptions {
  systemPrompt?: string;
  enableThinking?: boolean;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  /** Repetition penalty (1.0 = no penalty, >1.0 = penalize repetition) */
  penaltyRepeat?: number;
  /** Pre-fill the start of the model's response to prevent thinking */
  responsePrefix?: string;
  onToken?: (token: string, parsed: {thinking: string; response: string; isThinking: boolean}) => void;
}

class LlamaService {
  private context: LlamaContext | null = null;
  private status: ModelStatus = 'uninitialized';
  private modelsDir: string;
  private modelPath: string;
  private loraPath: string;

  private melPath: string;
  private asrPath: string;
  private tokenizerPath: string;

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/models`;
    this.modelPath = `${this.modelsDir}/${MODEL_FILENAME}`;
    this.loraPath = `${this.modelsDir}/${LORA_FILENAME}`;
    this.melPath = `${this.modelsDir}/${MEL_FILENAME}`;
    this.asrPath = `${this.modelsDir}/${ASR_FILENAME}`;
    this.tokenizerPath = `${this.modelsDir}/${TOKENIZER_FILENAME}`;
  }

  getAsrModelPaths(): {mel: string; asr: string; tokenizer: string} {
    return {mel: this.melPath, asr: this.asrPath, tokenizer: this.tokenizerPath};
  }

  getStatus(): ModelStatus {
    return this.status;
  }

  isReady(): boolean {
    return this.status === 'ready' && this.context !== null;
  }

  async checkModelsExist(): Promise<boolean> {
    try {
      const checks = await Promise.all([
        RNFS.exists(this.modelPath),
        RNFS.exists(this.loraPath),
        RNFS.exists(this.melPath),
        RNFS.exists(this.asrPath),
        RNFS.exists(this.tokenizerPath),
      ]);
      return checks.every(Boolean);
    } catch {
      return false;
    }
  }

  async downloadModels(
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    this.status = 'downloading';

    const dirExists = await RNFS.exists(this.modelsDir);
    if (!dirExists) {
      await RNFS.mkdir(this.modelsDir);
    }

    const downloads: [string, string, string][] = [
      [MEL_URL, this.melPath, 'MedASR Mel'],
      [ASR_URL, this.asrPath, 'MedASR Encoder'],
      [TOKENIZER_URL, this.tokenizerPath, 'Tokenizer'],
      [LORA_URL, this.loraPath, 'LocalScribe LoRA'],
      [MODEL_URL, this.modelPath, 'MedGemma 1.5 4B'],
    ];

    for (const [url, dest, name] of downloads) {
      const exists = await RNFS.exists(dest);
      if (!exists) {
        await this.downloadFile(url, dest, name, onProgress);
      }
    }
  }

  private async downloadFile(
    url: string,
    destPath: string,
    filename: string,
    onProgress?: (progress: DownloadProgress) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      RNFS.downloadFile({
        fromUrl: url,
        toFile: destPath,
        background: true,
        discretionary: false,
        progressDivider: 1,
        progress: res => {
          const progress = (res.bytesWritten / res.contentLength) * 100;
          onProgress?.({file: filename, progress});
        },
      })
        .promise.then(result => {
          if (result.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Download failed with status ${result.statusCode}`));
          }
        })
        .catch(err => reject(err));
    });
  }

  async loadModel(onProgress?: (progress: number) => void): Promise<void> {
    // Guard: don't re-load if already ready
    if (this.context && this.status === 'ready') {
      return;
    }
    this.status = 'loading';

    try {
      const context = await initLlama(
        {
          model: this.modelPath,
          lora: this.loraPath,
          n_ctx: 4096,
          n_threads: 6,
          n_batch: 512,
          n_ubatch: 512,
          n_gpu_layers: 0,
          cache_type_k: 'q4_0',
          cache_type_v: 'q8_0',
          use_mlock: true,
          use_mmap: true,
          ctx_shift: false,
          use_progress_callback: true,
          cache_prompt: true,
        },
        (progress: number) => {
          onProgress?.(progress);
        },
      );

      if (!context) {
        throw new Error('Failed to initialize model context');
      }

      this.context = context;
      this.status = 'ready';
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  async initialize(
    onDownloadProgress?: (progress: DownloadProgress) => void,
    onLoadProgress?: (progress: number) => void,
  ): Promise<void> {
    const modelsExist = await this.checkModelsExist();

    if (!modelsExist) {
      await this.downloadModels(onDownloadProgress);
    }

    await this.loadModel(onLoadProgress);
  }

  private parseThinkingOutput(text: string): {thinking: string; response: string; isThinking: boolean} {
    const hasThinkingStart = text.includes('<unused94>');
    const hasThinkingEnd = text.includes('<unused95>');

    if (hasThinkingStart && hasThinkingEnd) {
      const parts = text.split('<unused95>');
      const thinking = parts[0].replace('<unused94>thought\n', '').replace('<unused94>', '').trim();
      const response = parts.slice(1).join('<unused95>').replace(/<unused\d+>/g, '').trim();
      return {thinking, response, isThinking: false};
    } else if (hasThinkingStart && !hasThinkingEnd) {
      const thinking = text.replace('<unused94>thought\n', '').replace('<unused94>', '').trim();
      return {thinking, response: '', isThinking: true};
    }

    const cleaned = text.replace(/<unused\d+>/g, '').trim();
    return {thinking: '', response: cleaned, isThinking: false};
  }

  async complete(
    prompt: string,
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    if (!this.context) {
      throw new Error('Model not loaded');
    }

    const {
      systemPrompt = 'You are an expert medical assistant.',
      enableThinking = true,
      maxTokens = 1500,
      temperature = 0.7,
      topP = 0.95,
      topK = 64,
      penaltyRepeat,
      responsePrefix,
      onToken,
    } = options;

    const systemContent = enableThinking
      ? `SYSTEM INSTRUCTION: think silently if needed. ${systemPrompt}`
      : systemPrompt;

    // Stop sequences - always stop on turn boundaries
    const stopSequences = ['<end_of_turn>', '<eos>', '</s>', '<start_of_turn>', '</transcript>'];
    // If thinking is disabled, also stop on thinking start tokens
    if (!enableThinking) {
      stopSequences.push('<unused94>');
    }

    let fullText = responsePrefix || '';

    const completionParams: any = {
      n_predict: maxTokens,
      temperature,
      top_p: topP,
      top_k: topK,
      stop: stopSequences,
      cache_prompt: true,
    };

    if (penaltyRepeat !== undefined) {
      completionParams.penalty_repeat = penaltyRepeat;
    }

    if (responsePrefix) {
      const rawPrompt = `<start_of_turn>user\n${systemContent}\n\n${prompt.trim()}<end_of_turn>\n<start_of_turn>model\n${responsePrefix}`;
      completionParams.prompt = rawPrompt;
    } else {
      completionParams.messages = [
        {role: 'system', content: systemContent},
        {role: 'user', content: prompt.trim()},
      ];
    }

    const result = await this.context.completion(
      completionParams,
      data => {
        fullText += data.token;
        if (onToken) {
          const parsed = this.parseThinkingOutput(fullText);
          onToken(data.token, parsed);
        }
      },
    );

    // Prepend the prefix to the result text for full output
    const fullResult = (responsePrefix || '') + result.text;
    const parsed = this.parseThinkingOutput(fullResult);
    return {
      thinking: parsed.thinking,
      response: parsed.response,
      rawText: fullResult,
    };
  }

  async stopCompletion(): Promise<void> {
    if (this.context) {
      await this.context.stopCompletion();
    }
  }

  async removeLoraAdapters(): Promise<void> {
    if (this.context) {
      await this.context.removeLoraAdapters();
      console.log('[LlamaService] LoRA adapters removed');
    }
  }

  async applyLoraAdapters(): Promise<void> {
    if (this.context) {
      await this.context.applyLoraAdapters([{path: this.loraPath}]);
      console.log('[LlamaService] LoRA adapters re-applied');
    }
  }

  async release(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
      this.status = 'uninitialized';
    }
  }
}

// Singleton instance
export const llamaService = new LlamaService();
export default llamaService;
