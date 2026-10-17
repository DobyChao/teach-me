import { useEffect, useRef } from 'react';
import type { Action, Snapshot } from '../shared/protocol.ts';

export function useMicrophone(state: Snapshot | null, act: (action: Action) => void) {
  const current = useRef(state);
  current.current = state;
  const id = state?.voice.id;
  const recording = state?.voice.phase === 'recording';
  const engine = state?.settings.voice.engine;
  useEffect(() => {
    if (!recording || !id || engine === 'system') return;
    let disposed = false;
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    const stopTracks = () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((value) => {
        stream = value;
        if (disposed) {
          stopTracks();
          return;
        }
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.onstop = async () => {
          try {
            if (current.current?.voice.id !== id || current.current.voice.phase !== 'transcribing')
              return;
            const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
            const data = new Uint8Array(await blob.arrayBuffer());
            if (data.byteLength > 8 * 1024 * 1024) throw new Error('录音过长，请缩短后重试');
            act({ type: 'voice-audio', id, mime: blob.type, data });
          } catch (e) {
            act({ type: 'voice-error', id, error: (e as Error).message });
          } finally {
            stopTracks();
          }
        };
        recorder.start();
      })
      .catch((e) => {
        stopTracks();
        if (!disposed) act({ type: 'voice-error', id, error: `无法访问麦克风：${e.message}` });
      });
    return () => {
      disposed = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else stopTracks();
    };
  }, [recording, id, engine, act]);
}
