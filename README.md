# LocalScribe

> **Submission to the [MedGemma Impact Challenge](https://www.kaggle.com/competitions/med-gemma-impact-challenge/overview)**

LocalScribe is a fully on-device medical scribe for Android. It listens to doctor–patient conversations (or dictated notes), transcribes speech in real time, extracts clinical findings, and generates structured clinical notes — all without sending a single byte of patient data off the device.

---

**Just want to try the demo APK on your device?**

[Download localscribe-demo-0.1.apk](https://github.com/ChrisRenton/LocalScribe-Demo/releases/download/v0.1/localscribe-demo-0.1.apk)

> **Heads up:** On first launch the app downloads ~3 GB of models (MedGemma 4B + MedASR). Be on Wi-Fi. Requires an Android phone with around **8 GB+ RAM**. Tested and working on a **Pixel 8 Pro**.

---

## How It Works

The app runs two AI models in a pipeline, entirely on the phone:

1. **MedASR** — Speech recognition model exported as split ONNX (mel extractor + ASR encoder). Audio is processed in ~5-second chunks with silence-boundary detection. A CTC beam search decoder produces multiple hypotheses per chunk, and uncertain words are flagged as beam candidates for downstream resolution by the ondevice LLM.

2. **MedGemma 4B** — Google's medical LLM, quantised and run locally via [llama.rn](https://github.com/nicklausw/llama.rn). Each transcribed chunk is streamed to the LLM which:
   - Resolves beam search alternatives (picks the correct word from candidates)
   - Extracts symptoms with confirmation status (confirmed / denied / mentioned)
   - Extracts medications with confirmation status
   - Annotates the transcript with structured XML tags

After the encounter, the full annotated transcript is fed back to MedGemma to generate a structured clinical note (SOAP, H&P, or custom templates).

## Features

- **Real-time transcription** with live beam-candidate highlighting
- **Streaming LLM annotation** — clinical findings appear as colour-coded pills during recording
- **Structured note generation** — SOAP, H&P, or user-defined templates with timestamped references
- **Tap-to-review** — tap any line in a generated note to play back the original audio from that point
- **HIPAA-compliant storage** — AES-256-GCM encrypted audio (Android Keystore-backed), SQLCipher-encrypted database for all patient data
- **Fully offline** — no network calls, no cloud dependencies, no data leaves the device
- **Built-in demos** — pre-recorded conversation and dictation WAVs for testing without a live patient

## Build

```bash
npm install
npx react-native bundle \
  --platform android --dev false \
  --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res/
cd android && ./gradlew assembleDebug
```

Install to a connected device:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Tech Stack

| | |
|---|---|
| Frontend | React Native 0.83, TypeScript |
| LLM runtime | llama.rn (llama.cpp) |
| ASR runtime | ONNX Runtime (Android) |
| Database | OP-SQLite + SQLCipher |
| Encryption | react-native-aes-crypto, react-native-keychain, Jetpack Security |
| Audio | Android AudioRecord (16kHz/16-bit/mono) |
