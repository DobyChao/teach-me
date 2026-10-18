import { useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '../shared/protocol.ts';

export function useThreadScroll(
  messages: Message[],
  sessionId: string | undefined,
  visible: boolean,
) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const readingTop = useRef(0);
  const previous = useRef({ sessionId, count: 0 });
  const [pending, setPending] = useState(0);
  const jump = () => {
    following.current = true;
    setPending(0);
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      readingTop.current = el.scrollTop;
    }
  };
  const onScroll = () => {
    const el = ref.current;
    if (!el || !visible || !el.clientHeight) return;
    readingTop.current = el.scrollTop;
    following.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32;
    if (following.current) setPending(0);
  };
  useLayoutEffect(() => {
    if (previous.current.sessionId !== sessionId || messages.length < previous.current.count) {
      following.current = true;
      readingTop.current = 0;
      previous.current = { sessionId, count: 0 };
      setPending(0);
    }
    const added = messages.slice(previous.current.count);
    previous.current = { sessionId, count: messages.length };
    if (following.current || added.some((m) => m.role === 'user')) {
      following.current = true;
      setPending(0);
      if (visible) jump();
    } else {
      if (visible && ref.current) ref.current.scrollTop = readingTop.current;
      const count = added.filter((m) => m.role === 'agent').length;
      if (count) setPending((old) => old + count);
    }
  }, [messages.length, sessionId, visible]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !visible) return;
    const observer = new ResizeObserver(() => {
      if (following.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, pending, jump, onScroll };
}
