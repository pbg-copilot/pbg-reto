import { useCallback, useState } from "react";
import type { Agent } from "../shared/types/domain";
import type { ApiRequest } from "../shared/api/api-client";
import { AccountMenu } from "../features/auth/components/AccountMenu";
import { ChatWorkspace } from "./ChatWorkspace";
import { HomeScreen } from "./HomeScreen";

type Props = { agent: Agent; api: ApiRequest; busy: boolean; onLogout: () => Promise<boolean> };

export function AuthenticatedWorkspace({ agent, api, busy, onLogout }: Props) {
  const [chatOpen, setChatOpen] = useState(false);
  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  return <div className="workspace">
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="RETO, inicio">RETO<span className="brand-dot" /></a>
      <AccountMenu agent={agent} busy={busy} modalOpen={chatOpen} onLogout={onLogout} />
    </header>
    <HomeScreen name={agent.name} onOpenChat={openChat} />
    <button className="chat-launcher" type="button" onClick={openChat}>
      <span className="launcher-icon">P</span><span>Chat PBG</span>
    </button>
    <ChatWorkspace agent={agent} api={api} open={chatOpen} onClose={closeChat} />
  </div>;
}
