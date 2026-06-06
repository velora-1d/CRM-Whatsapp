"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, Save, AlertCircle, Upload, Loader2, Image as ImageIcon, UserPlus } from "lucide-react";
import { toast } from "sonner";

export default function SettingsPage() {
    const { data: authSession } = useSession();
    const isSuperAdmin = (authSession?.user as any)?.role === "SUPERADMIN";

    const [systemConfig, setSystemConfig] = useState({
        appName: "Velora CRM",
        logoUrl: "",
        timezone: "Asia/Jakarta",
        enableRegistration: true
    });
    const [systemLoading, setSystemLoading] = useState(false);
    const [timezones, setTimezones] = useState<string[]>(["UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]);

    useEffect(() => {
        try {
            if (typeof Intl !== "undefined" && Intl.supportedValuesOf) {
                const list = Intl.supportedValuesOf("timeZone");
                if (!list.includes("UTC")) {
                    list.push("UTC");
                }
                list.sort();
                setTimezones(list);
            }
        } catch (e) {
            console.error("Failed to load timezones dynamically", e);
        }
    }, []);

    useEffect(() => {
        fetch('/api/settings/system')
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(responseData => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    setSystemConfig({
                        appName: data.appName || "Velora CRM",
                        logoUrl: data.logoUrl || "",
                        // @ts-ignore
                        faviconUrl: data.faviconUrl || "/favicon.ico",
                        timezone: data.timezone || "Asia/Jakarta",
                        enableRegistration: data.enableRegistration !== undefined ? data.enableRegistration : true
                    });
                }
            })
            .catch(() => { });
    }, []);

    const handleSaveSystem = async () => {
        setSystemLoading(true);
        try {
            const res = await fetch('/api/settings/system', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(systemConfig)
            });

            if (res.ok) {
                toast.success("System settings updated. Refresh to see changes.");
            } else {
                toast.error("Failed to update system settings");
            }
        } catch (e) {
            console.error(e);
            toast.error("Error saving system settings");
        } finally {
            setSystemLoading(false);
        }
    };

    const [logoUploading, setLogoUploading] = useState(false);
    const [faviconUploading, setFaviconUploading] = useState(false);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "logo" | "favicon") => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validation: size limit 5MB
        if (file.size > 5 * 1024 * 1024) {
            toast.error("File size must be less than 5MB");
            return;
        }

        // Validation: image type
        if (!file.type.startsWith("image/")) {
            toast.error("Please upload an image file");
            return;
        }

        const isLogo = type === "logo";
        if (isLogo) setLogoUploading(true);
        else setFaviconUploading(true);

        try {
            const formData = new FormData();
            formData.append("file", file);

            const res = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });

            const data = await res.json();
            if (data.status && data.url) {
                setSystemConfig(prev => ({ 
                    ...prev, 
                    [isLogo ? "logoUrl" : "faviconUrl"]: data.url 
                }));
                toast.success(`${isLogo ? "Logo" : "Favicon"} uploaded successfully`);
            } else {
                throw new Error(data.message || "Failed to upload file");
            }
        } catch (error: any) {
            console.error(error);
            toast.error(error.message || `Failed to upload ${type}`);
        } finally {
            if (isLogo) setLogoUploading(false);
            else setFaviconUploading(false);
        }
    };

    const inputClass = "flex h-10 w-full rounded-xl border border-black dark:border-white/30 bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:pointer-events-none disabled:opacity-50 transition-all font-medium";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Settings</h2>
                <p className="text-muted-foreground text-sm mt-1">Global system configuration. Only SuperAdmins can make changes.</p>
            </div>

            {!isSuperAdmin && (
                <Card className="border-yellow-200 bg-yellow-50">
                    <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-yellow-900">View Only Mode</p>
                                <p className="text-xs text-yellow-700 mt-1">
                                    Only Superadmins can modify system settings. You can view current settings but cannot make changes.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* System Configuration (Global) */}
            <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                    <CardTitle className="text-xl">App Configuration</CardTitle>
                    <CardDescription>Global settings for the application branding and access control.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>Application Name</Label>
                            <input
                                className={inputClass}
                                placeholder="Velora CRM"
                                value={systemConfig.appName}
                                onChange={(e) => setSystemConfig(prev => ({ ...prev, appName: e.target.value }))}
                                disabled={!isSuperAdmin}
                            />
                            <p className="text-xs text-muted-foreground">Changes the name in the sidebar and browser title.</p>
                        </div>

                        <div className="grid gap-2">
                            <Label>Timezone</Label>
                            <select
                                className={inputClass}
                                value={systemConfig.timezone}
                                onChange={(e) => setSystemConfig(prev => ({ ...prev, timezone: e.target.value }))}
                                disabled={!isSuperAdmin}
                            >
                                {timezones.map((tz) => (
                                    <option key={tz} value={tz}>
                                        {tz}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-muted-foreground">Scheduler will use this timezone.</p>
                        </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-6">
                        <div className="grid gap-3">
                            <Label className="text-xs font-bold text-foreground/80">Application Logo</Label>
                            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl border border-border/60 bg-background/50 dark:bg-slate-900/30">
                                <div className="h-20 w-36 rounded-xl border border-dashed border-border/80 bg-background/80 flex items-center justify-center overflow-hidden flex-shrink-0 relative group">
                                    {systemConfig.logoUrl ? (
                                        <>
                                            <img src={systemConfig.logoUrl} alt="Logo" className="max-h-16 max-w-[120px] object-contain rounded-lg transition-transform duration-300 group-hover:scale-105" />
                                            {isSuperAdmin && (
                                                <button
                                                    onClick={() => setSystemConfig(prev => ({ ...prev, logoUrl: "" }))}
                                                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-semibold transition-opacity duration-200 cursor-pointer"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center gap-1.5 text-muted-foreground/60">
                                            <ImageIcon className="h-6 w-6" />
                                            <span className="text-[10px] font-medium">No Logo</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 space-y-2 text-center sm:text-left">
                                    <h5 className="text-xs font-semibold text-foreground">Upload custom logo</h5>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                        Recommend PNG or SVG with transparent background. Max size 5MB.
                                    </p>
                                    {isSuperAdmin && (
                                        <label className={`inline-flex h-9 px-4 rounded-xl border border-border bg-background hover:bg-muted text-xs font-bold items-center justify-center gap-2 cursor-pointer select-none transition-all ${logoUploading ? 'pointer-events-none opacity-50' : ''}`}>
                                            {logoUploading ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                            ) : (
                                                <Upload className="h-3.5 w-3.5" />
                                            )}
                                            <span>{systemConfig.logoUrl ? "Change Logo" : "Upload Logo"}</span>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => handleFileUpload(e, "logo")}
                                                disabled={logoUploading}
                                            />
                                        </label>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="grid gap-3">
                            <Label className="text-xs font-bold text-foreground/80">Browser Favicon</Label>
                            <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl border border-border/60 bg-background/50 dark:bg-slate-900/30">
                                <div className="h-20 w-20 rounded-xl border border-dashed border-border/80 bg-background/80 flex items-center justify-center overflow-hidden flex-shrink-0 relative group">
                                    {(systemConfig as any).faviconUrl ? (
                                        <>
                                            <img src={(systemConfig as any).faviconUrl} alt="Favicon" className="h-10 w-10 object-contain rounded transition-transform duration-300 group-hover:scale-105" />
                                            {isSuperAdmin && (
                                                <button
                                                    onClick={() => setSystemConfig(prev => ({ ...prev, faviconUrl: "" }))}
                                                    className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-semibold transition-opacity duration-200 cursor-pointer"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <div className="flex flex-col items-center gap-1.5 text-muted-foreground/60">
                                            <ImageIcon className="h-6 w-6" />
                                            <span className="text-[10px] font-medium">No Favicon</span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 space-y-2 text-center sm:text-left">
                                    <h5 className="text-xs font-semibold text-foreground">Upload custom favicon</h5>
                                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                                        Requires .ico, .png, or .svg files. Max size 2MB.
                                    </p>
                                    {isSuperAdmin && (
                                        <label className={`inline-flex h-9 px-4 rounded-xl border border-border bg-background hover:bg-muted text-xs font-bold items-center justify-center gap-2 cursor-pointer select-none transition-all ${faviconUploading ? 'pointer-events-none opacity-50' : ''}`}>
                                            {faviconUploading ? (
                                                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                                            ) : (
                                                <Upload className="h-3.5 w-3.5" />
                                            )}
                                            <span>{(systemConfig as any).faviconUrl ? "Change Favicon" : "Upload Favicon"}</span>
                                            <input
                                                type="file"
                                                accept="image/x-icon,image/png,image/jpeg"
                                                className="hidden"
                                                onChange={(e) => handleFileUpload(e, "favicon")}
                                                disabled={faviconUploading}
                                            />
                                        </label>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 sm:p-5 rounded-2xl border border-border/60 bg-background/50 dark:bg-slate-900/30 flex items-center justify-between gap-4 transition-all duration-300 hover:border-primary/30 hover:bg-background/80 dark:hover:bg-slate-900/50 mt-2">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-primary/10 text-primary rounded-xl flex-shrink-0 transition-transform duration-300 group-hover:scale-105">
                                <UserPlus className="h-5 w-5" />
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Label htmlFor="enable-registration" className="text-sm font-semibold cursor-pointer text-foreground">
                                        Enable User Registration
                                    </Label>
                                    {systemConfig.enableRegistration ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            Active
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                            Disabled
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    Allow new users to sign up for accounts. Turn off to keep the platform private.
                                </p>
                            </div>
                        </div>
                        <Switch
                            id="enable-registration"
                            checked={systemConfig.enableRegistration}
                            onCheckedChange={c => setSystemConfig(prev => ({ ...prev, enableRegistration: c }))}
                            disabled={!isSuperAdmin}
                            className="flex-shrink-0"
                        />
                    </div>

                    <div className="pt-4 flex justify-end">
                        <Button 
                            onClick={handleSaveSystem} 
                            disabled={systemLoading || !isSuperAdmin}
                            className="shadow-sm font-semibold px-6 py-2 rounded-xl transition-all bg-primary hover:bg-primary/95 text-white"
                        >
                            {systemLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Save Configuration
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* System Updates */}
            <Card>
                <CardHeader>
                    <CardTitle>System Updates</CardTitle>
                    <CardDescription>Check for the latest version from GitHub.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button
                        variant="outline"
                        className="w-full"
                        onClick={async () => {
                            setSystemLoading(true);
                            try {
                                const res = await fetch("/api/system/check-updates", { method: "POST" });
                                const data = await res.json();
                                if (data.status) {
                                    toast.success(data.message || "Check complete!");
                                } else {
                                    toast.error(data.message || "Failed to check updates");
                                }
                            } catch (e) {
                                toast.error("Error checking updates");
                            } finally {
                                setSystemLoading(false);
                            }
                        }}
                        disabled={systemLoading}
                    >
                        <RefreshCw className={`mr-2 h-4 w-4 ${systemLoading ? 'animate-spin' : ''}`} />
                        Check for Updates
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
