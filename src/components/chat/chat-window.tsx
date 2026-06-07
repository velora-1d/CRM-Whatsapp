"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, ArrowLeft, Phone, MoreVertical, X, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Image as ImageIcon, FileText, Music, Sticker as StickerIcon, Video, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import { getChatMessages, sendChatMessage, sendMediaMessage, getChatMetadata } from "@/app/dashboard/chat/actions";

interface Message {
    keyId: string;
    content: string;
    fromMe: boolean;
    timestamp: string;
    type: string;
    status: string;
    pushName?: string;
    senderJid?: string;
    senderName?: string;
    mediaUrl?: string;
    remoteJid?: string;
}

interface ChatWindowProps {
    sessionId: string;
    jid: string;
    name?: string;
    profilePic?: string | null;
    onBack?: () => void;
}

export function ChatWindow({ sessionId, jid, name, profilePic, onBack }: ChatWindowProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const [socket, setSocket] = useState<Socket | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadType, setUploadType] = useState<string>("image");
    const [isDragging, setIsDragging] = useState(false);

    // Info panel state
    const [showInfoPanel, setShowInfoPanel] = useState(false);
    const [metadata, setMetadata] = useState<any>(null);
    const [loadingMetadata, setLoadingMetadata] = useState(false);
    const [participantSearchQuery, setParticipantSearchQuery] = useState("");

    const fetchMetadata = async () => {
        setLoadingMetadata(true);
        try {
            const data = await getChatMetadata(sessionId, jid);
            setMetadata(data);
        } catch (error) {
            console.error("Failed to load chat metadata", error);
        } finally {
            setLoadingMetadata(false);
        }
    };

    useEffect(() => {
        if (showInfoPanel) {
            fetchMetadata();
        } else {
            setMetadata(null);
        }
    }, [jid, showInfoPanel]);

    const scrollToBottom = (smooth = true) => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const fetchMessages = async () => {
        try {
            const data = await getChatMessages(sessionId, jid);
            setMessages((data as any) || []);
            setTimeout(() => scrollToBottom(false), 100);
        } catch (error) {
            console.error("Failed to load messages via Server Action", error);
        }
    }

    useEffect(() => {
        setMessages([]);
        fetchMessages();

        const newSocket = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });

        newSocket.on("connect", () => {
            newSocket.emit("join-session", sessionId);
        });

        const normalizedJid = jid.endsWith("@c.us") ? jid.replace("@c.us", "@s.whatsapp.net") : jid;

        newSocket.on("message.update", (newMessages: Message[]) => {
            setMessages((prev) => {
                const combined = [...prev, ...newMessages.filter(m => 
                    m.remoteJid === normalizedJid || prev.some(p => p.remoteJid === m.remoteJid)
                )];
                const unique = Array.from(new Map(combined.map(m => [m.keyId, m])).values());
                return unique.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            });
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, [sessionId, jid]);

    const handleSend = async () => {
        if (!newMessage.trim()) return;

        try {
            await sendChatMessage(sessionId, jid, newMessage);
            setNewMessage("");
            // Give Baileys time to fire messages.upsert and save to DB
            setTimeout(() => fetchMessages(), 800);
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Failed to send message");
        }
    };

    const processFileUpload = async (file: File, explicitType?: string) => {
        const formData = new FormData();
        formData.append("file", file);

        let type = explicitType;
        if (!type || type === '*') {
            if (file.type.startsWith('image/')) type = 'image';
            else if (file.type.startsWith('video/')) type = 'video';
            else if (file.type.startsWith('audio/')) type = 'audio';
            else type = 'document';
        }

        formData.append("type", type);
        formData.append("sessionId", sessionId);
        formData.append("jid", jid);

        try {
            toast.info(`Sending ${file.name}...`);
            await sendMediaMessage(formData);
            toast.success("Sent!");
            setTimeout(() => fetchMessages(), 800);
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || "Failed to send media");
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        await processFileUpload(file, uploadType);
        
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            // Process the first file for now
            await processFileUpload(files[0]);
        }
    };

    const handleDownload = async (url: string, fileName: string) => {
        try {
            toast.info("Downloading file...");
            const response = await fetch(url);
            if (!response.ok) throw new Error("File not found or unreachable");
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error("Download failed", error);
            toast.error("Download failed! Ensure the file URL is accessible.");
        }
    };

    const triggerUpload = (type: string) => {
        setUploadType(type);
        if (fileInputRef.current) {
            fileInputRef.current.accept = type === 'image' ? "image/*" : type === 'video' ? "video/*" : type === 'audio' ? "audio/*" : type === 'sticker' ? "image/*" : "*/*";
            fileInputRef.current.click();
        }
    };

    // Group messages by date
    const getDateLabel = (timestamp: string) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const displayName = name || jid.split('@')[0];

    return (
        <div className="flex h-full w-full overflow-hidden bg-slate-100 dark:bg-zinc-950 relative">
            {/* Main Chat Area */}
            <div 
                className="flex-1 flex flex-col h-full overflow-hidden relative"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
            {/* Drag & Drop Overlay */}
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary flex items-center justify-center flex-col gap-3 rounded-lg m-2">
                    <div className="h-16 w-16 bg-primary/20 rounded-full flex items-center justify-center">
                        <Paperclip className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-lg font-semibold text-primary">Drop files to send here</p>
                </div>
            )}

            {/* Header */}
            <div className="h-14 px-4 bg-slate-50 dark:bg-zinc-800/60 border-b border-border/20 flex items-center justify-between flex-shrink-0 z-10">
                <div 
                    className="flex items-center gap-3 min-w-0 cursor-pointer select-none flex-1 py-1 hover:opacity-90 active:opacity-80 transition-opacity"
                    onClick={() => setShowInfoPanel(!showInfoPanel)}
                >
                    {onBack && (
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8.5 w-8.5 md:hidden flex-shrink-0 text-muted-foreground hover:text-foreground mr-1"
                            onClick={(e) => {
                                e.stopPropagation();
                                onBack();
                            }}
                        >
                            <ArrowLeft className="h-4.5 w-4.5" />
                        </Button>
                    )}
                    <Avatar className="h-9 w-9 flex-shrink-0 border border-border/30">
                        <AvatarImage src={profilePic || ""} className="object-cover" />
                        <AvatarFallback className="text-xs font-semibold bg-gradient-to-br from-primary/20 to-blue-500/20 text-primary">
                            {displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                        <h3 className="text-xs font-bold text-foreground truncate leading-snug">{displayName}</h3>
                        <p className="text-[10px] text-muted-foreground/90 truncate leading-none mt-0.5">
                            {jid.endsWith("@g.us") ? "Group Chat" : jid.split("@")[0]}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                    <Button variant="ghost" size="icon" className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:bg-muted/65">
                        <Phone className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:bg-muted/65">
                        <MoreVertical className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-4 py-4 styled-scrollbar relative z-0 bg-slate-100 dark:bg-zinc-950" style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%239C92AC' fill-opacity='0.05'%3E%3Cpath d='M50 50c0-5.522 4.478-10 10-10s10 4.478 10 10-4.478 10-10 10c0 5.522-4.478 10-10 10s-10-4.478-10-10 4.478-10 10-10zM10 10c0-5.522 4.478-10 10-10s10 4.478 10 10-4.478 10-10 10c0 5.522-4.478 10-10 10S0 25.522 0 20s4.478-10 10-10zm10 8c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8zm40 40c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8z'/%3E%3C/g%3E%3C/svg%3E")`,
                backgroundRepeat: 'repeat'
            }}>
                <div className="space-y-1.5 max-w-3xl mx-auto">
                    {messages.map((msg, idx) => {
                        // Show date separator
                        const showDate = idx === 0 || getDateLabel(msg.timestamp) !== getDateLabel(messages[idx - 1].timestamp);

                        return (
                            <div key={msg.keyId}>
                                {showDate && (
                                    <div className="flex justify-center my-3">
                                        <span className="text-[10px] font-medium text-muted-foreground bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-border/30">
                                            {getDateLabel(msg.timestamp)}
                                        </span>
                                    </div>
                                )}
                                <div className={cn("flex", msg.fromMe ? "justify-end" : "justify-start")}>
                                    <div
                                        className={cn(
                                            "max-w-[75%] sm:max-w-[65%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap shadow-sm",
                                            msg.fromMe
                                                ? "bg-primary text-primary-foreground rounded-tr-none"
                                                : "bg-background border border-border/30 rounded-tl-none text-foreground"
                                        )}
                                    >
                                        {/* Sender Name (group messages) */}
                                        {!msg.fromMe && jid.endsWith("@g.us") && (
                                            <span className="text-[10px] font-semibold text-primary block mb-0.5">
                                                {msg.senderName || msg.pushName || (msg.senderJid ? `+${msg.senderJid.split('@')[0]}` : "Anggota Grup")}
                                            </span>
                                        )}

                                        {/* Media */}
                                        {msg.type === 'IMAGE' && msg.mediaUrl && (
                                            <div className="relative group/media mb-1.5">
                                                <img src={msg.mediaUrl} alt="Image" className="rounded-lg max-h-60 object-cover w-full cursor-pointer hover:opacity-95 transition-opacity" />
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `IMAGE-${msg.keyId}.jpg`)}
                                                >
                                                    <Download className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                        {msg.type === 'VIDEO' && msg.mediaUrl && (
                                            <div className="relative group/media mb-1.5">
                                                <video src={msg.mediaUrl} controls className="rounded-lg max-h-60 w-full" />
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="absolute top-2 right-2 h-8 w-8 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm z-10"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `VIDEO-${msg.keyId}.mp4`)}
                                                >
                                                    <Download className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                        {msg.type === 'AUDIO' && msg.mediaUrl && (
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <audio src={msg.mediaUrl} controls className="h-8 max-w-[200px]" />
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8 rounded-full"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `AUDIO-${msg.keyId}.mp3`)}
                                                >
                                                    <Download className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )}
                                        {msg.type === 'STICKER' && msg.mediaUrl && (
                                            <div className="relative group/media mb-1">
                                                <img src={msg.mediaUrl} alt="Sticker" className="rounded-lg max-h-32 object-contain" />
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="absolute -top-1 -right-1 h-6 w-6 rounded-full opacity-0 group-hover/media:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm"
                                                    onClick={() => handleDownload(msg.mediaUrl!, `STICKER-${msg.keyId}.webp`)}
                                                >
                                                    <Download className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        )}
                                        {msg.type !== 'TEXT' && msg.type !== 'IMAGE' && msg.type !== 'STICKER' && msg.type !== 'VIDEO' && msg.type !== 'AUDIO' && (
                                            <div className={cn(
                                                "flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg mb-1 text-xs",
                                                msg.fromMe ? "bg-white/15" : "bg-muted/50"
                                            )}>
                                                <div className="flex items-center gap-2 truncate">
                                                    <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                                                    <span className="font-medium truncate">{msg.type} Message</span>
                                                </div>
                                                {msg.mediaUrl && (
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 rounded-full flex-shrink-0"
                                                        onClick={() => handleDownload(msg.mediaUrl!, `${msg.type}-${msg.keyId}`)}
                                                    >
                                                        <Download className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        )}

                                        {/* Content + Time */}
                                        <div className="flex items-end gap-2">
                                            <span className="flex-1">{msg.content}</span>
                                            <span className={cn(
                                                "text-[9px] flex-shrink-0 leading-none translate-y-0.5",
                                                msg.fromMe ? "text-primary-foreground/60" : "text-muted-foreground"
                                            )}>
                                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={scrollRef} />
                </div>
            </div>

            {/* Input Area */}
            <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-800/60 border-t border-border/20 flex-shrink-0 z-10">
                <div className="flex items-center gap-3 max-w-4xl mx-auto">
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={handleFileUpload}
                    />
                    
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Button variant="ghost" size="icon" className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:bg-muted/80">
                            <span className="text-[17px]">😊</span>
                        </Button>
                        
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:bg-muted/80">
                                    <Paperclip className="h-4.5 w-4.5" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-44 p-1.5" side="top" align="start">
                                <div className="flex flex-col gap-0.5">
                                    <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('image')}>
                                        <ImageIcon className="h-3.5 w-3.5 text-blue-500" /> Image
                                    </Button>
                                    <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('video')}>
                                        <Video className="h-3.5 w-3.5 text-purple-500" /> Video
                                    </Button>
                                    <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('audio')}>
                                        <Music className="h-3.5 w-3.5 text-orange-500" /> Audio
                                    </Button>
                                    <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('document')}>
                                        <FileText className="h-3.5 w-3.5 text-emerald-500" /> Document
                                    </Button>
                                    <Button variant="ghost" size="sm" className="justify-start gap-2 h-8 text-xs" onClick={() => triggerUpload('sticker')}>
                                        <StickerIcon className="h-3.5 w-3.5 text-pink-500" /> Sticker
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex-1 bg-background dark:bg-zinc-900 border border-border/40 rounded-xl px-4 py-2 flex items-center min-w-0 shadow-inner focus-within:ring-1 focus-within:ring-primary/40 focus-within:border-primary/40 transition-all">
                        <textarea
                            placeholder="Type a message..."
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            rows={1}
                            className="w-full bg-transparent text-xs border-0 focus:outline-none resize-none placeholder:text-muted-foreground/80 text-foreground max-h-24 min-h-[18px] leading-relaxed"
                        />
                    </div>

                    <Button
                        onClick={handleSend}
                        disabled={!newMessage.trim()}
                        size="icon"
                        className="h-8.5 w-8.5 rounded-full flex-shrink-0 shadow-sm bg-primary hover:bg-primary/95 text-white"
                    >
                        <Send className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
            </div>

            {/* Right-side Info Panel */}
            {showInfoPanel && (
                <div className="w-full md:w-80 lg:w-[340px] h-full border-l border-border/20 bg-background flex flex-col flex-shrink-0 absolute md:static right-0 top-0 bottom-0 z-40 shadow-xl md:shadow-none animate-in slide-in-from-right duration-200">
                    {/* Panel Header */}
                    <div className="h-14 px-4 bg-slate-50 dark:bg-zinc-800/60 border-b border-border/20 flex items-center gap-3 flex-shrink-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8.5 w-8.5 rounded-full text-muted-foreground hover:bg-muted/65"
                            onClick={() => setShowInfoPanel(false)}
                        >
                            <X className="h-4.5 w-4.5" />
                        </Button>
                        <h3 className="font-bold text-xs text-foreground tracking-tight">
                            {jid.endsWith("@g.us") ? "Group info" : "Contact info"}
                        </h3>
                    </div>

                    {/* Panel Content */}
                    <div className="flex-1 overflow-y-auto styled-scrollbar p-4 space-y-4">
                        {loadingMetadata && !metadata ? (
                            <div className="space-y-4 py-8">
                                <div className="h-28 w-28 rounded-full bg-muted/40 animate-pulse mx-auto" />
                                <div className="h-4 w-32 bg-muted/40 animate-pulse mx-auto rounded-md" />
                                <div className="h-3 w-40 bg-muted/40 animate-pulse mx-auto rounded-md" />
                            </div>
                        ) : metadata ? (
                            <>
                                {/* Large Profile Picture */}
                                <div className="flex flex-col items-center text-center pb-4 border-b border-border/10">
                                    <Avatar className="h-28 w-28 border-2 border-border/30 shadow-md">
                                        <AvatarImage src={metadata.profilePic || ""} className="object-cover" />
                                        <AvatarFallback className="text-xl font-bold bg-gradient-to-br from-primary/20 to-blue-500/20 text-primary">
                                            {displayName.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    
                                    <h4 className="mt-3.5 text-sm font-bold text-foreground truncate max-w-full px-2">
                                        {metadata.name || displayName}
                                    </h4>
                                    
                                    <p className="text-[11px] text-muted-foreground/80 mt-1 select-all font-mono">
                                        {metadata.phone || jid.split("@")[0]}
                                    </p>
                                </div>

                                {/* About / Description Section */}
                                <div className="bg-slate-50/50 dark:bg-zinc-900/30 p-3.5 rounded-xl border border-border/30 space-y-2">
                                    <h5 className="text-[10px] font-bold text-primary uppercase tracking-wider">
                                        {metadata.isGroup ? "Group description" : "About"}
                                    </h5>
                                    <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                                        {metadata.isGroup 
                                            ? (metadata.description || "No description set")
                                            : (metadata.verifiedName ? `Verified: ${metadata.verifiedName}` : "Active WhatsApp client")
                                        }
                                    </p>
                                </div>

                                {/* Group Details */}
                                {metadata.isGroup && (
                                    <div className="text-[10.5px] text-muted-foreground space-y-1 bg-slate-50/30 dark:bg-zinc-900/10 p-3 rounded-lg border border-border/20">
                                        {metadata.creation && (
                                            <p>Created: <span className="font-semibold text-foreground">{new Date(metadata.creation).toLocaleDateString([], { dateStyle: 'medium' })}</span></p>
                                        )}
                                        {metadata.ownerJid && (
                                            <p className="truncate">Creator: <span className="font-semibold text-foreground font-mono select-all">{metadata.ownerJid.split("@")[0]}</span></p>
                                        )}
                                        <p>JID: <span className="font-semibold text-foreground font-mono select-all truncate block text-[9.5px] mt-0.5">{metadata.jid}</span></p>
                                    </div>
                                )}

                                {/* Participants List */}
                                {metadata.isGroup && (
                                    <div className="space-y-3 pt-2">
                                        <div className="flex items-center justify-between">
                                            <h5 className="text-[10.5px] font-bold text-foreground uppercase tracking-wider">
                                                Participants ({metadata.participants?.length || 0})
                                            </h5>
                                        </div>

                                        {/* Participant Search */}
                                        <div className="relative flex items-center bg-slate-100 dark:bg-zinc-800/40 rounded-lg px-2.5 py-1.5 h-8">
                                            <Search className="h-3.5 w-3.5 text-muted-foreground mr-1.5 flex-shrink-0" />
                                            <input
                                                placeholder="Search participant..."
                                                value={participantSearchQuery}
                                                onChange={(e) => setParticipantSearchQuery(e.target.value)}
                                                className="w-full bg-transparent text-[11px] border-0 focus:outline-none placeholder:text-muted-foreground/80 text-foreground"
                                            />
                                        </div>

                                        <div className="space-y-1.5 max-h-64 overflow-y-auto styled-scrollbar divide-y divide-border/10 pr-1">
                                            {metadata.participants
                                                ?.filter((p: any) => {
                                                    const query = participantSearchQuery.toLowerCase();
                                                    const phone = p.phone || "";
                                                    const name = (p.name || "").toLowerCase();
                                                    return phone.includes(query) || name.includes(query);
                                                })
                                                .map((p: any) => (
                                                    <div key={p.jid} className="flex items-center justify-between py-2 text-xs">
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <Avatar className="h-7 w-7 flex-shrink-0 border border-border/20">
                                                                <AvatarImage src={p.profilePic || ""} className="object-cover" />
                                                                <AvatarFallback className="text-[10px] font-bold bg-primary/10 text-primary">
                                                                    {(p.name || p.phone).slice(0, 2).toUpperCase()}
                                                                </AvatarFallback>
                                                            </Avatar>
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="font-semibold text-foreground truncate block">
                                                                    {p.name || p.phone}
                                                                </span>
                                                                {p.name && (
                                                                    <span className="text-[9.5px] text-muted-foreground font-mono block leading-none mt-0.5">
                                                                        {p.phone}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {p.isAdmin && (
                                                            <span className="text-[8.5px] font-bold text-orange-500 bg-orange-500/10 dark:bg-orange-500/20 px-1.5 py-0.5 rounded border border-orange-500/20 uppercase tracking-wide">
                                                                Admin
                                                            </span>
                                                        )}
                                                    </div>
                                                ))
                                            }
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-center text-xs text-muted-foreground py-8">
                                Failed to retrieve data
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
