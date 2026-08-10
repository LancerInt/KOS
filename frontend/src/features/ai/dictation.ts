/**
 * Dictation — speaking into any AI input instead of typing.
 *
 * Two routes, picked per browser, behind one hook:
 *
 * 1. **The browser's own recognition** (`SpeechRecognition`). Free, no server
 *    round trip, and words appear *while* you speak, which is what makes long
 *    dictation bearable. Chrome, Edge and Safari have it; Firefox does not.
 * 2. **Record and send** (`MediaRecorder` → `/ai/transcribe/` → Whisper). The
 *    fallback that makes dictation work in Firefox at all. No live text — the
 *    transcript lands a moment after you stop — and it costs a paid call, so
 *    it is only reached when route 1 is absent.
 *
 * Both need a secure context (HTTPS or localhost). Where neither is available
 * the hook reports `supported: false` and callers show no microphone: a mic
 * that cannot produce words is worse than no mic at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getStatus, transcribeAudio } from "./aiApi";

/** idle → listening → (transcribing, fallback route only) → idle */
export type DictationState = "idle" | "listening" | "transcribing";

// The Web Speech API is still vendor-prefixed in Chrome and Safari and is
// absent from TypeScript's DOM lib, so it is reached through a narrow local
// shape rather than pulling in an ambient type package for four fields.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** The first container this browser will actually record. Chrome and Firefox
 *  produce webm/opus; Safari only mp4. An unsupported string makes MediaRecorder
 *  throw, so it is checked rather than assumed. */
function recordingMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
}

/** Server transcription availability, fetched once per page load and shared —
 *  every mic on the screen would otherwise ask the same question. */
let serverDictation: Promise<boolean> | null = null;
function serverCanTranscribe(): Promise<boolean> {
  if (!serverDictation) {
    serverDictation = getStatus()
      .then((s) => !!s.transcription)
      .catch(() => false);
  }
  return serverDictation;
}

const FRIENDLY_ERROR: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in your browser's site settings.",
  "service-not-allowed": "Microphone access was blocked. Allow it in your browser's site settings.",
  "no-speech": "Didn't catch anything — try again a little closer to the mic.",
  "audio-capture": "No microphone found.",
  network: "Speech recognition couldn't reach the network.",
};

/**
 * Add a dictated chunk to whatever is already in the field.
 *
 * Dictation extends a draft rather than replacing it — you can type half a
 * sentence, speak the rest, and keep going. Native recognition delivers a
 * clause at a time, so without deliberate spacing here a long dictation arrives
 * as onewordrunintothenext.
 */
export function appendSpoken(current: string, spoken: string): string {
  const text = spoken.trim();
  if (!text) return current;
  if (!current.trim()) return text;
  return /\s$/.test(current) ? current + text : `${current} ${text}`;
}

export interface Dictation {
  /** False when this browser can offer no dictation at all — render no mic. */
  supported: boolean;
  state: DictationState;
  /** Words recognised but not yet final, for a live hint under the field. */
  interim: string;
  error: string;
  toggle: () => void;
  stop: () => void;
}

/**
 * @param onText Called with each finished chunk of speech. Consumers decide
 *   where it goes — every one of them appends to what is already typed, so
 *   dictation adds to a draft rather than replacing it.
 */
export function useDictation(onText: (text: string) => void): Dictation {
  const [supported, setSupported] = useState(() => recognitionCtor() !== null);
  const [state, setState] = useState<DictationState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // The callback is read at speech time, not at subscribe time, so a consumer
  // re-rendering mid-sentence cannot leave the handler writing into a stale
  // closure — which is how dictated words go missing.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // No native recognition → the mic is only worth showing if the server can
  // transcribe. Asked once, and only by browsers that actually need the answer.
  useEffect(() => {
    if (recognitionCtor() || !canRecord()) return;
    let alive = true;
    serverCanTranscribe().then((ok) => { if (alive) setSupported(ok); });
    return () => { alive = false; };
  }, []);

  /** Hand the microphone back. Skipping this leaves the browser's recording
   *  indicator lit long after the user stopped talking. */
  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  // Unmounting mid-sentence (closing the dialog) must not leave a live
  // recogniser or a hot microphone behind.
  useEffect(() => () => {
    recognitionRef.current?.abort();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const startNative = useCallback((Ctor: RecognitionCtor) => {
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;      // don't cut out at the first pause
    recognition.interimResults = true;  // show words as they are spoken

    // Whether this session ever heard anything. Recognition can end in silence
    // — a muted mic, the wrong input device, a blocked speech service — and
    // without this the button would just flick back to idle saying nothing,
    // which is indistinguishable from the feature being broken.
    let heard = false;
    let failed = false;

    recognition.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        heard = heard || !!text.trim();
        // Final chunks are committed as they arrive; the rest is only a hint,
        // so a long sentence is never lost if recognition ends unexpectedly.
        if (result.isFinal) onTextRef.current(text.trim());
        else pending += text;
      }
      setInterim(pending);
    };
    recognition.onerror = (event) => {
      // "aborted" is what our own stop() raises — not something to report.
      if (event.error === "aborted") return;
      failed = true;
      setError(FRIENDLY_ERROR[event.error] ?? `Dictation stopped: ${event.error}.`);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setInterim("");
      setState("idle");
      if (!heard && !failed) {
        setError(
          "Didn't hear anything. Check the microphone your browser is using, " +
          "then try again — speak while the button is red."
        );
      }
    };

    recognitionRef.current = recognition;
    setState("listening");
    try {
      recognition.start();
    } catch {
      // start() throws if a previous session is still winding down. Without
      // this the button would stay stuck on red with no recogniser behind it.
      recognitionRef.current = null;
      setState("idle");
      setError("Dictation was already running. Try again in a moment.");
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = recordingMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        releaseMic();
        recorderRef.current = null;
        const clip = new Blob(chunks, { type: mimeType || "audio/webm" });
        // A tap rather than a sentence — nothing was said, so say nothing.
        if (clip.size < 1200) { setState("idle"); return; }
        setState("transcribing");
        try {
          const text = await transcribeAudio(clip, navigator.language || "");
          if (text.trim()) onTextRef.current(text.trim());
          else setError("Didn't catch anything — try again a little closer to the mic.");
        } catch {
          setError("Couldn't transcribe that recording. Try again, or type it instead.");
        } finally {
          setState("idle");
        }
      };

      recorderRef.current = recorder;
      setState("listening");
      recorder.start();
    } catch {
      releaseMic();
      setState("idle");
      setError("Microphone access was blocked. Allow it in your browser's site settings.");
    }
  }, [releaseMic]);

  const toggle = useCallback(() => {
    if (state !== "idle") { stop(); return; }
    setError("");
    const Ctor = recognitionCtor();
    if (Ctor) startNative(Ctor);
    else void startRecording();
  }, [state, stop, startNative, startRecording]);

  return { supported, state, interim, error, toggle, stop };
}
