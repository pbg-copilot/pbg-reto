import { useLayoutEffect, useRef } from "react";
import type { Message } from "../domain";

type Options = { messages: Message[]; loading: boolean; visible: boolean; contextKey: string };
type ScrollSnapshot = {
  contextKey: string;
  firstId: string | undefined;
  lastId: string | undefined;
  count: number;
  height: number;
  top: number;
  viewportHeight: number;
};

export function useTimelineScroll({ messages, loading, visible, contextKey }: Options) {
  const feedRef = useRef<HTMLDivElement>(null);
  const snapshot = useRef<ScrollSnapshot | null>(null);

  function rememberPosition() {
    const feed = feedRef.current;
    if (!feed || !visible || loading) return;
    snapshot.current = {
      contextKey, firstId: messages[0]?.id, lastId: messages.at(-1)?.id,
      count: messages.length, height: feed.scrollHeight, top: feed.scrollTop,
      viewportHeight: feed.clientHeight,
    };
  }

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed || !visible || loading) return;
    const previous = snapshot.current;
    if (!previous || previous.contextKey !== contextKey || previous.count === 0) {
      feed.scrollTop = feed.scrollHeight;
    } else if (messages.length > previous.count && messages[0]?.id !== previous.firstId &&
        messages.some((message) => message.id === previous.firstId)) {
      // Keep the same message in view when an older page is prepended.
      feed.scrollTop = previous.top + feed.scrollHeight - previous.height;
    } else if (messages.at(-1)?.id !== previous.lastId &&
        previous.height - previous.top - previous.viewportHeight < 80) {
      feed.scrollTop = feed.scrollHeight;
    }
    rememberPosition();
  }, [messages, loading, visible, contextKey]);

  return { feedRef, onScroll: rememberPosition };
}
