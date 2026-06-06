"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquarePlus, Search, MessageCircle, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

import { cn } from "@/lib/utils";
import { io } from "socket.io-client";
import { getChatsStatus } from "@/app/dashboard/chat/actions";

interface ChatContact {
    jid: string;
    name: string | null;
    notify: string | null;
    profilePic: string | null;
    lastMessage?: {
        content: string | null;
        timestamp: string;
        type: string;
    }
}

interface ChatListProps {
    sessionId: string;
    onSelectChat: (jid: string, name?: string) => void;
    selectedJid?: string;
}

export function ChatList({ sessionId, onSelectChat, selectedJid }: ChatListProps) {
    const [chats, setChats] = useState<ChatContact[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [newChatNumber, setNewChatNumber] = useState("");
    
    // Track JIDs in a ref for reliable real-time updates without depending on state closure
    const jidsInList = useRef<Set<string>>(new Set());

    const fetchChats = async () => {
        try {
            const rawChats = await getChatsStatus(sessionId);
            
            // Deduplicate by JID - keep the one with the latest message
            const chatMap = new Map<string, ChatContact>();
            rawChats.forEach((c: any) => {
                const existing = chatMap.get(c.jid);
                if (!existing || (c.lastMessage?.timestamp && (!existing.lastMessage?.timestamp || new Date(c.lastMessage.timestamp) > new Date(existing.lastMessage.timestamp)))) {
                    chatMap.set(c.jid, c);
                }
            });
            setChats(Array.from(chatMap.values()));
        } catch (error) {
            console.error("Failed to load chats via Server Action", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (sessionId) {
            fetchChats();

            const socket = io({
                path: "/api/socket/io",
                addTrailingSlash: false,
            });

            socket.on("connect", () => {
                socket.emit("join-session", sessionId);
            });

            socket.on("message.update", async (newMessages: any[]) => {
                let shouldFetchAll = false;

                setChats((prevChats) => {
                    const updatedChats = [...prevChats];
                    let needsReorder = false;

                    newMessages.forEach(msg => {
                        const messageJid = msg.remoteJid;
                        const chatIndex = updatedChats.findIndex(c => c.jid === messageJid);
                        
                        if (chatIndex !== -1) {
                            updatedChats[chatIndex] = {
                                ...updatedChats[chatIndex],
                                lastMessage: {
                                    content: msg.content,
                                    timestamp: msg.timestamp,
                                    type: msg.type
                                }
                            };
                            needsReorder = true;
                        } else if (!jidsInList.current.has(messageJid)) {
                            // Message from a JID not in our current list
                            shouldFetchAll = true;
                        }
                    });

                    if (needsReorder) {
                        updatedChats.sort((a, b) => {
                            const tA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
                            const tB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
                            return tB - tA;
                        });
                    }

                    return updatedChats;
                });

                if (shouldFetchAll) {
                    await fetchChats();
                }
            });

            return () => {
                socket.disconnect();
            };
        }
    }, [sessionId]);

    // Update the JID tracking ref whenever the chats list changes
    useEffect(() => {
        jidsInList.current = new Set(chats.map(c => c.jid));
    }, [chats]);

    // Filter chats based on search query
    const filteredChats = useMemo(() => {
        if (!searchQuery.trim()) return chats;
        const q = searchQuery.toLowerCase();
        return chats.filter(chat => {
            const name = (chat.name || chat.notify || "").toLowerCase();
            const jid = chat.jid.toLowerCase();
            return name.includes(q) || jid.includes(q);
        });
    }, [chats, searchQuery]);

    const getContactDisplayName = (chat: ChatContact): string => {
        return chat.name || chat.notify || chat.jid.split('@')[0];
    };

    const getMessagePreview = (chat: ChatContact): string => {
        if (!chat.lastMessage?.content) return "No messages yet";
        const content = chat.lastMessage.content;
        if (chat.lastMessage.type !== "TEXT") {
            return `📎 ${chat.lastMessage.type.charAt(0) + chat.lastMessage.type.slice(1).toLowerCase()}`;
        }
        return content.length > 45 ? content.slice(0, 45) + "…" : content;
    };

    const getTimeLabel = (timestamp: string): string => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return "Yesterday";
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const handleStartNewChat = () => {
        if (!newChatNumber) return;
        let clean = newChatNumber.replace(/\D/g, '');
        if (clean.startsWith('0')) clean = '62' + clean.substring(1);
        const jid = `${clean}@s.whatsapp.net`;
        onSelectChat(jid);
        setIsNewChatOpen(false);
        setNewChatNumber("");
    };

    if (loading) {
        return (
            <div className="p-3 space-y-3">
                <Skeleton className="h-9 w-full rounded-lg" />
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex items-center gap-3 p-2">
                        <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3.5 w-28" />
                            <Skeleton className="h-3 w-40" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-background">
            {/* WhatsApp Header bar */}
            <div className="h-14 bg-slate-50 dark:bg-zinc-800/60 border-b border-border/20 px-4 flex justify-between items-center flex-shrink-0">
                <div className="flex items-center gap-2.5">
                    <Avatar className="h-8.5 w-8.5 border border-border/30">
                        <AvatarImage src="/logo.jpg" className="object-cover" />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">V</AvatarFallback>
                    </Avatar>
                    <span className="font-bold text-[14.5px] text-foreground tracking-tight">Chats</span>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:bg-muted/65"
                        onClick={() => setIsNewChatOpen(!isNewChatOpen)}
                    >
                        {isNewChatOpen ? (
                            <X className="h-4.5 w-4.5 text-foreground" />
                        ) : (
                            <MessageSquarePlus className="h-4.5 w-4.5 text-foreground" />
                        )}
                    </Button>
                </div>
            </div>

            {/* WhatsApp Search Bar Section */}
            <div className="px-3 py-2 bg-background flex-shrink-0 border-b border-border/10">
                <div className="relative flex items-center bg-slate-100 dark:bg-zinc-800/40 rounded-lg px-2.5 py-1.5 h-8.5">
                    <Search className="h-3.5 w-3.5 text-muted-foreground ml-0.5 flex-shrink-0" />
                    <input
                        placeholder="Search or start new chat"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-transparent text-xs border-0 focus:outline-none pl-2.5 placeholder:text-muted-foreground/80 text-foreground"
                    />
                </div>
            </div>

            {/* New Chat Form */}
            {isNewChatOpen && (
                <div className="px-3 py-2 bg-slate-50 dark:bg-zinc-800/20 border-b border-border/15 flex-shrink-0 space-y-2">
                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Start chat with number</Label>
                    <div className="flex gap-1.5">
                        <Input
                            placeholder="e.g., 628123456789"
                            value={newChatNumber}
                            onChange={(e) => setNewChatNumber(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleStartNewChat()}
                            className="h-8.5 text-xs rounded-lg border-black dark:border-white/30 focus-visible:ring-primary/50"
                        />
                        <Button size="sm" className="h-8.5 px-3.5 font-semibold text-xs" onClick={handleStartNewChat}>Go</Button>
                    </div>
                </div>
            )}

            {/* Chat List */}
            <div className="flex-1 overflow-y-auto styled-scrollbar divide-y divide-border/10">
                {filteredChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                        <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-zinc-800/50 flex items-center justify-center mb-3">
                            <MessageCircle className="h-5.5 w-5.5 text-muted-foreground/40" />
                        </div>
                        <p className="text-xs text-muted-foreground/80">
                            {searchQuery ? "No chats match your search" : "No chats yet"}
                        </p>
                    </div>
                ) : (
                    filteredChats.map((chat) => {
                        const displayName = getContactDisplayName(chat);
                        const isSelected = selectedJid === chat.jid;
                        return (
                            <button
                                key={chat.jid}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-3 text-left transition-all duration-150 border-b border-border/10 overflow-hidden relative",
                                    isSelected
                                        ? "bg-slate-100 dark:bg-zinc-800"
                                        : "hover:bg-slate-50 dark:hover:bg-zinc-900/40 bg-background"
                                )}
                                onClick={() => onSelectChat(chat.jid, displayName, chat.profilePic)}
                            >
                                <Avatar className="h-10 w-10 flex-shrink-0 border border-border/20">
                                    <AvatarImage src={chat.profilePic || ""} />
                                    <AvatarFallback className="text-xs font-semibold bg-gradient-to-br from-primary/20 to-blue-500/20 text-primary">
                                        {displayName.slice(0, 2).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0 overflow-hidden">
                                    <div className="flex justify-between items-baseline gap-2 overflow-hidden mb-0.5">
                                        <h4 className={cn(
                                            "text-xs truncate",
                                            isSelected ? "font-bold text-primary" : "font-semibold text-foreground"
                                        )}>
                                            {displayName}
                                        </h4>
                                        {chat.lastMessage && (
                                            <span className="text-[9.5px] text-muted-foreground flex-shrink-0 font-medium">
                                                {getTimeLabel(chat.lastMessage.timestamp)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-muted-foreground/90 truncate leading-relaxed">
                                        {getMessagePreview(chat)}
                                    </p>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
}
