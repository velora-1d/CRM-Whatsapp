'use client';

import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { useRouter } from 'next/navigation';
import { toast } from "sonner";
import { Label } from '@/components/ui/label';
import { Smartphone, Plus, Trash2, Settings, RefreshCw, Power, UserPlus, Key } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type Session = {
    id: string;
    name: string;
    sessionId: string;
    status: string;
    qr?: string | null;
};

export function SessionManager({ user }: { user: any }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [newSessionName, setNewSessionName] = useState("");
    const [newSessionId, setNewSessionId] = useState("");
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const router = useRouter();

    useEffect(() => {
        fetchSessions();

        // Init Socket
        const socketInstance = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });

        socketInstance.on('connect', () => {
            console.log('Socket connected');
        });

        socketInstance.on('connection.update', (data: { sessionId: string, status: string, qr: string }) => {
            // Update specific session status if match
            setSessions(prev => prev.map(s => {
                if (s.sessionId === data.sessionId) {
                    return { ...s, status: data.status, qr: data.qr };
                }
                return s;
            }));

            if (data.status === 'CONNECTED') {
                fetchSessions(); // Refresh purely to get updated state from DB if needed
            }
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    const fetchSessions = () => {
        fetch('/api/sessions').then(res => res.json()).then(responseData => {
            const data = responseData?.data || [];
            if (Array.isArray(data)) setSessions(data);
        });
    }

    const createSession = async () => {
        if (!newSessionName) {
            toast.error("Session name is required");
            return;
        }

        // If ID matches existing
        if (newSessionId && sessions.some(s => s.sessionId === newSessionId)) {
            toast.error("Session ID already exists");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    name: newSessionName,
                    sessionId: newSessionId || undefined // Optional, backend will generate if empty
                })
            });
            const responseData = await res.json();
            const session = responseData?.data;

            if (!res.ok || !session) throw new Error(responseData.error || responseData.message || "Failed to create");

            setSessions([...sessions, session]);
            setNewSessionName("");
            setNewSessionId("");
            toast.success("Session created successfully");

            // Optionally redirect immediately or let user choose
            // router.push(`/dashboard/sessions/${session.sessionId}`);
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Failed to create session");
        } finally {
            setLoading(false);
        }
    };

    const handleManageSession = (sessionId: string) => {
        router.push(`/dashboard/sessions/${sessionId}`);
    }

    return (
        <div className="space-y-8">
            {/* Create New Session Card */}
            <Card className="bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-950/50 border border-slate-200/80 dark:border-slate-800/80 shadow-md shadow-black/5 dark:shadow-none rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-black/5">
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-bold flex items-center gap-2.5 text-foreground">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <Plus className="h-5 w-5" />
                        </div>
                        Create New Session
                    </CardTitle>
                    <CardDescription className="text-xs sm:text-sm text-muted-foreground pl-10">
                        Add a new WhatsApp account to manage.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                    <div className="flex flex-col md:flex-row gap-5 items-end">
                        <div className="flex-1 w-full space-y-1.5">
                            <Label htmlFor="session-name" className="text-xs font-semibold text-foreground/80 pl-0.5">Session Name</Label>
                            <div className="relative">
                                <Input
                                    id="session-name"
                                    value={newSessionName}
                                    onChange={e => setNewSessionName(e.target.value)}
                                    placeholder="My Business WA"
                                    className="pl-9 h-11 rounded-xl bg-background/50 border-black dark:border-white/30 focus-visible:ring-primary/50 transition-all font-medium"
                                />
                                <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground/60" />
                            </div>
                        </div>
                        <div className="flex-1 w-full space-y-1.5">
                            <div className="flex justify-between items-center px-0.5">
                                <Label htmlFor="session-id" className="text-xs font-semibold text-foreground/80">Custom Session ID (Optional)</Label>
                                <span className="text-[10px] text-muted-foreground/60 font-medium">Letters, numbers, hyphens</span>
                            </div>
                            <div className="relative">
                                <Input
                                    id="session-id"
                                    value={newSessionId}
                                    onChange={e => setNewSessionId(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))}
                                    placeholder="unique-id-123"
                                    className="pl-9 h-11 rounded-xl bg-background/50 border-black dark:border-white/30 focus-visible:ring-primary/50 transition-all font-medium"
                                />
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground/60" />
                            </div>
                        </div>
                        <Button 
                            onClick={createSession} 
                            disabled={loading}
                            className="w-full md:w-auto h-11 px-6 rounded-xl bg-primary hover:bg-primary/95 text-primary-foreground font-semibold shadow-md shadow-primary/10 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                        >
                            {loading ? 'Creating...' : 'Create Session'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Sessions Grid */}
            <div>
                <h2 className="text-xl font-bold mb-5 text-foreground flex items-center gap-2">
                    Active Sessions
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-muted-foreground">
                        {sessions.length}
                    </span>
                </h2>
                {sessions.length === 0 ? (
                    <div className="text-center py-16 text-muted-foreground bg-slate-50/50 dark:bg-slate-900/30 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800">
                        <Smartphone className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3 animate-bounce" />
                        <p className="font-semibold text-sm">No sessions found</p>
                        <p className="text-xs text-muted-foreground/75 mt-1">Create a session above to get started.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {sessions.map(session => (
                            <Card key={session.id} className="group hover-lift bg-card border border-border/60 rounded-3xl overflow-hidden transition-all duration-300">
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                                    <CardTitle className="text-base font-bold truncate text-foreground/90">
                                        {session.name}
                                    </CardTitle>
                                    <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-muted-foreground/80 group-hover:scale-110 transition-transform duration-300">
                                        <Smartphone className="h-4.5 w-4.5" />
                                    </div>
                                </CardHeader>
                                <CardContent className="pb-4">
                                    <div className="text-xl font-extrabold truncate mb-3 text-foreground tracking-tight">{session.sessionId}</div>
                                    <div className="flex items-center">
                                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all ${
                                            session.status === 'CONNECTED' 
                                                ? 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20' 
                                                : 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20'
                                        }`}>
                                            <span className={`h-1.5 w-1.5 rounded-full ${
                                                session.status === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500 animate-pulse'
                                            }`} />
                                            {session.status}
                                        </div>
                                    </div>
                                </CardContent>
                                <CardFooter className="bg-slate-50/50 dark:bg-slate-950/20 border-t border-border/30 p-4 flex justify-end gap-2.5">
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => router.push(`/dashboard/sessions/access?session=${session.sessionId}`)}
                                        className="h-9 px-4 rounded-xl text-xs font-semibold border-border/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Share
                                    </Button>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => handleManageSession(session.sessionId)}
                                        className="h-9 px-4 rounded-xl text-xs font-semibold border-border/60 hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-all"
                                    >
                                        <Settings className="h-3.5 w-3.5 mr-1.5" /> Manage
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
