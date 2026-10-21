import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Uses the installed Windows recognizer directly, not Chromium Web Speech.
export class SystemSpeech {
  private child: ReturnType<typeof spawn> | null = null;
  private done: Promise<string> = Promise.resolve('');
  private cancelRun: (() => void) | null = null;
  async start(live: (text: string) => void) {
    this.abort();
    const text: string[] = [];
    const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); try { Add-Type -AssemblyName System.Speech; $r=[System.Speech.Recognition.SpeechRecognitionEngine]::new(); $r.SetInputToDefaultAudioDevice(); $r.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new()); $s=Register-ObjectEvent -InputObject $r -EventName SpeechRecognized -Action { [Console]::WriteLine('TEXT:'+ [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($EventArgs.Result.Text))) }; $r.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple); [Console]::WriteLine('READY'); $read=[Console]::In.ReadLineAsync(); while(-not $read.IsCompleted){Start-Sleep -Milliseconds 50}; $r.RecognizeAsyncStop(); Start-Sleep -Milliseconds 500; $r.Dispose(); Unregister-Event -SourceIdentifier $s.Name; } catch { [Console]::WriteLine('ERROR:'+ [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.Message))); exit 1 }`;
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    this.child = child;
    let buffer = '';
    let readyResolve!: () => void;
    let readyReject!: (e: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    let doneReject!: (e: Error) => void;
    let canceled = false;
    let started = false;
    // Every callback owns only this child, even after a replacement starts.
    const cancelRun = (error = new Error('录音已取消')) => {
      if (canceled) return;
      canceled = true;
      clearTimeout(timer);
      readyReject(error);
      doneReject(error);
      if (this.child === child) {
        this.child = null;
        this.cancelRun = null;
      }
      child.kill();
    };
    const timer = setTimeout(() => {
      cancelRun(new Error('Windows 语音识别启动超时'));
    }, 8000);
    this.cancelRun = cancelRun;
    this.done = new Promise<string>((resolve, reject) => {
      doneReject = reject;
      child.stdout!.on('data', (data) => {
        if (canceled || this.child !== child) return;
        buffer += String(data);
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (line === 'READY') {
            started = true;
            clearTimeout(timer);
            readyResolve();
          } else if (line.startsWith('TEXT:')) {
            text.push(Buffer.from(line.slice(5), 'base64').toString('utf8'));
            live(text.join(''));
          } else if (line.startsWith('ERROR:')) {
            const e = new Error(Buffer.from(line.slice(6), 'base64').toString('utf8'));
            cancelRun(e);
            return;
          }
        }
      });
      child.on('error', (e) => {
        cancelRun(e);
      });
      child.on('exit', (code) => {
        if (canceled) return;
        clearTimeout(timer);
        if (code === 0 && started) resolve(text.join(''));
        else {
          const e = new Error('Windows 语音识别不可用，请在设置中选择本地或自定义引擎');
          cancelRun(e);
        }
      });
      child.stdin!.on('error', () => {});
    });
    this.done.catch(() => {});
    await ready;
  }
  async stop() {
    const child = this.child;
    if (!child) return this.done;
    const done = this.done;
    const cancelRun = this.cancelRun;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      child.stdin!.write('stop\n');
      return await Promise.race([
        done,
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new Error('系统转写超时')), 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      cancelRun?.();
    }
  }
  abort() {
    this.cancelRun?.();
  }
}

export async function transcribe(
  data: Uint8Array,
  mime: string,
  config: { engine: string; customUrl: string; localCommand: string },
  directory: string,
) {
  if (config.engine === 'custom') {
    const url = new URL(config.customUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('语音 API 仅支持 HTTP(S)');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': mime },
      body: new Uint8Array(data).buffer,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`语音 API 返回 ${response.status}`);
    const result = (await response.json()) as { text?: string; transcript?: string };
    return String(result.text || result.transcript || '');
  }
  if (!config.localCommand.trim()) throw new Error('请先设置本地识别程序路径');
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(
    directory,
    `audio-${randomUUID()}.${mime.includes('wav') ? 'wav' : 'webm'}`,
  );
  try {
    await fs.writeFile(file, data);
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(config.localCommand, [file], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      const chunks: Buffer[] = [];
      const errors: Buffer[] = [];
      let size = 0;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('本地识别超时'));
      }, 20000);
      child.stdout.on('data', (data) => {
        size += data.length;
        if (size > 128 * 1024) {
          child.kill();
          reject(new Error('识别输出过大'));
        } else chunks.push(data);
      });
      child.stderr.on('data', (data) => {
        if (Buffer.concat(errors).length < 8192) errors.push(data);
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(chunks).toString('utf8').trim());
        else reject(new Error(Buffer.concat(errors).toString('utf8') || '本地识别失败'));
      });
    });
  } finally {
    await fs.rm(file, { force: true });
  }
}
