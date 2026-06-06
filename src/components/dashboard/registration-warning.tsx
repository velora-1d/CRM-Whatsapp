"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { AlertCircle, ShieldAlert } from "lucide-react";

interface RegistrationWarningProps {
    role?: string;
    registrationEnabled?: boolean;
}

export function RegistrationWarning({ role, registrationEnabled }: RegistrationWarningProps) {
    useEffect(() => {
        if (role === "SUPERADMIN" && registrationEnabled) {
            // Delay toast slightly to wait for `<Toaster>` provider mount in layout
            const timer = setTimeout(() => {
                toast.custom((t) => (
                    <div className="flex items-start gap-4 p-5 rounded-2xl bg-white/95 dark:bg-amber-950/20 backdrop-blur-xl border border-amber-500/30 text-amber-900 dark:text-amber-200 shadow-2xl shadow-black/5 dark:shadow-amber-500/10 max-w-md w-full relative overflow-hidden transition-all duration-300 animate-in fade-in slide-in-from-top-4">
                        {/* Glow effect */}
                        <div className="absolute -left-10 -top-10 w-24 h-24 bg-amber-500/20 rounded-full blur-2xl pointer-events-none" />
                        
                        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex-shrink-0 animate-pulse">
                            <ShieldAlert className="w-6 h-6" />
                        </div>
                        
                        <div className="flex-1 space-y-1 min-w-0">
                            <h4 className="font-bold text-sm sm:text-base tracking-tight text-amber-900 dark:text-amber-100">Public Registration is Enabled</h4>
                            <p className="text-[11px] sm:text-xs text-amber-800/80 dark:text-amber-200/80 leading-relaxed font-medium">
                                Anyone can register to this instance. If this is unintended, disable it in System Settings to prevent unauthorized access.
                            </p>
                            <div className="flex items-center gap-2 pt-3">
                                <button 
                                    onClick={() => {
                                        toast.dismiss(t);
                                        window.location.href = "/dashboard/settings";
                                    }}
                                    className="h-8 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 active:scale-95 text-white text-xs font-semibold shadow-md shadow-amber-500/20 transition-all duration-200 cursor-pointer"
                                >
                                    Settings
                                </button>
                                <button 
                                    onClick={() => toast.dismiss(t)}
                                    className="h-8 px-3 rounded-lg border border-amber-500/20 hover:bg-amber-500/10 text-amber-900 dark:text-amber-300 text-xs font-semibold transition-all duration-200 cursor-pointer"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    </div>
                ), {
                    duration: 8000,
                    position: "top-center"
                });
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [role, registrationEnabled]);

    return null;
}
