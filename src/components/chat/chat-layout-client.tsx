"use client";

import { useState } from "react";
import { ChatList } from "./chat-list";
import { ChatWindow } from "./chat-window";
import { MessageCircle } from "lucide-react";

interface ChatLayoutClientProps {
    sessionId: string;
}

interface SelectedChat {
    jid: string;
    name?: string;
    profilePic?: string | null;
}

export function ChatLayoutClient({ sessionId }: ChatLayoutClientProps) {
    const [selectedChat, setSelectedChat] = useState<SelectedChat | null>(null);

    const handleSelectChat = (jid: string, name?: string, profilePic?: string | null) => {
        setSelectedChat({ jid, name, profilePic });
    };

    const handleBack = () => {
        setSelectedChat(null);
    };

    return (
        <div className="flex h-full bg-background rounded-xl border border-border/40 shadow-sm overflow-hidden relative">
            {/* Chat List Panel */}
            <div
                className={`
                    w-full md:w-80 lg:w-[340px] border-r border-border/30 h-full overflow-hidden flex-shrink-0
                    absolute md:static inset-0 z-20 bg-background
                    transition-transform duration-300 ease-in-out
                    ${selectedChat ? "-translate-x-full md:translate-x-0" : "translate-x-0"}
                `}
            >
                <ChatList
                    sessionId={sessionId}
                    onSelectChat={handleSelectChat}
                    selectedJid={selectedChat?.jid}
                />
            </div>

            {/* Chat Window Panel */}
            <div
                className={`
                    flex-1 h-full overflow-hidden
                    absolute md:static inset-0 z-10 bg-background
                    transition-transform duration-300 ease-in-out
                    ${selectedChat ? "translate-x-0 z-30" : "translate-x-full md:translate-x-0"}
                `}
            >
                {selectedChat ? (
                    <ChatWindow
                        sessionId={sessionId}
                        jid={selectedChat.jid}
                        name={selectedChat.name}
                        profilePic={selectedChat.profilePic}
                        onBack={handleBack}
                    />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center bg-slate-50/40 dark:bg-zinc-900/10 border-l border-border/10">
                        <div className="text-center p-8 max-w-sm space-y-4">
                            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-5 relative animate-float">
                                <MessageCircle className="h-10 w-10 text-primary" />
                                <div className="absolute inset-0 rounded-full bg-primary/5 blur-lg z-[-1] scale-125" />
                            </div>
                            <h2 className="text-xl font-bold text-foreground tracking-tight">Velora Web Chat</h2>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Send and receive messages in real-time. Select a chat from the sidebar to view conversion history and start messaging.
                            </p>
                            <div className="pt-6 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/80 font-semibold uppercase tracking-wider">
                                <span>🔒</span>
                                <span>End-to-End Encrypted Session</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
