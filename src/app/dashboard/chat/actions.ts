"use server";

import { prisma } from "@/lib/prisma";
import { ChatService } from "@/modules/whatsapp/chat.service";
import { getAuthenticatedUserForAction } from "@/lib/server-action-auth";
import { canAccessSession } from "@/lib/api-auth";

// Fetch chat list
export async function getChatsStatus(sessionId: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) return [];
    
    return await ChatService.getChatsList(session.id);
}

// Fetch messages for a specific chat
export async function getChatMessages(sessionId: string, jid: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) return [];

    const messages = await ChatService.getMessages(session.id, jid, 100);

    // Fetch contacts to map sender names dynamically
    const contacts = await prisma.contact.findMany({
        where: { sessionId: session.id },
        select: { jid: true, name: true, notify: true }
    });

    const contactMap = new Map(contacts.map(c => [c.jid, c.name || c.notify]));

    return messages.map(msg => {
        const senderJid = msg.senderJid;
        let senderName = msg.pushName || "";
        if (senderJid) {
            const savedName = contactMap.get(senderJid);
            if (savedName) {
                senderName = savedName;
            } else if (!senderName) {
                senderName = `+${senderJid.split('@')[0]}`;
            }
        }
        return {
            ...msg,
            senderName,
            timestamp: msg.timestamp.toISOString()
        };
    });
}

// Send a basic text message
export async function sendChatMessage(sessionId: string, jid: string, text: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        await ChatService.sendTextMessage(sessionId, jid, { text });
        return { success: true };
    } catch (error: any) {
        throw new Error(`Failed to send message: ${error.message}`);
    }
}

// Upload and Send Media
export async function sendMediaMessage(formData: FormData) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const sessionId = formData.get("sessionId") as string;
    const jid = formData.get("jid") as string;
    const file = formData.get("file") as File;
    const type = formData.get("type") as string;
    const caption = formData.get("caption") as string || "";

    if (!sessionId || !jid || !file || !type) {
        throw new Error("Missing required fields");
    }

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    try {
        const buffer = Buffer.from(await file.arrayBuffer());
        
        await ChatService.sendMediaMessage(
            sessionId,
            jid,
            buffer,
            type,
            file.type,
            file.name,
            caption
        );

        return { success: true };
    } catch (error: any) {
        console.error("Media send error:", error);
        throw new Error(`Failed to send media: ${error.message}`);
    }
}

// Fetch details for contact or group info panel
export async function getChatMetadata(sessionId: string, jid: string) {
    const user = await getAuthenticatedUserForAction();
    if (!user) throw new Error("Unauthorized");

    const canAccess = await canAccessSession(user.id, user.role, sessionId);
    if (!canAccess) throw new Error("Forbidden");

    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true }
    });

    if (!session) return null;

    const dbSessionId = session.id;

    // Check if it's a group
    if (jid.endsWith("@g.us")) {
        // Try to sync group metadata live if connected
        const { waManager } = await import("@/modules/whatsapp/manager");
        const instance = waManager.getInstance(sessionId);
        if (instance && instance.socket) {
            try {
                const g = await instance.socket.groupMetadata(jid);
                if (g) {
                    await prisma.group.upsert({
                        where: { sessionId_jid: { sessionId: dbSessionId, jid } },
                        create: {
                            sessionId: dbSessionId,
                            jid,
                            subject: g.subject,
                            description: g.desc || "",
                            ownerJid: g.owner || null,
                            creation: g.creation ? new Date(g.creation * 1000) : undefined,
                            restrict: g.restrict,
                            announce: g.announce,
                            participants: g.participants as any,
                            metadata: g as any
                        },
                        update: {
                            subject: g.subject,
                            description: g.desc || "",
                            ownerJid: g.owner || null,
                            restrict: g.restrict,
                            announce: g.announce,
                            participants: g.participants as any,
                            metadata: g as any
                        }
                    });
                }
            } catch (err) {
                console.error("Failed to fetch live group metadata in getChatMetadata:", err);
            }
        }

        // Fetch from DB
        const group = await prisma.group.findUnique({
            where: {
                sessionId_jid: {
                    sessionId: dbSessionId,
                    jid
                }
            }
        });

        if (!group) {
            return {
                isGroup: true,
                jid,
                name: jid.split("@")[0],
                description: "",
                participants: []
            };
        }

        // Get participants
        const rawParticipants = Array.isArray(group.participants)
            ? group.participants as any[]
            : (group.participants ? JSON.parse(JSON.stringify(group.participants)) : []);

        const participantJids = rawParticipants.map((p: any) => p.id).filter(Boolean);

        // Fetch contact details from our DB for these participants
        const contacts = await prisma.contact.findMany({
            where: {
                sessionId: dbSessionId,
                jid: { in: participantJids }
            },
            select: {
                jid: true,
                name: true,
                notify: true,
                profilePic: true
            }
        });

        const contactMap = new Map(contacts.map(c => [c.jid, c]));

        const participantsWithDetails = rawParticipants.map((p: any) => {
            const contact = contactMap.get(p.id);
            const phone = p.id.split("@")[0];
            return {
                jid: p.id,
                phone,
                name: contact?.name || contact?.notify || null,
                profilePic: contact?.profilePic || null,
                isAdmin: p.admin === "admin" || p.admin === "superadmin" || !!p.admin,
                adminType: p.admin || null
            };
        });

        return {
            isGroup: true,
            jid,
            name: group.subject || jid.split("@")[0],
            description: group.description || "",
            ownerJid: group.ownerJid || null,
            creation: group.creation ? group.creation.toISOString() : null,
            participants: participantsWithDetails
        };
    } else {
        // Individual contact
        // Let's try to update profile pic url live if session is active
        let livePic: string | null = null;
        const { waManager } = await import("@/modules/whatsapp/manager");
        const instance = waManager.getInstance(sessionId);
        if (instance && instance.socket) {
            try {
                const picUrl = await instance.socket.profilePictureUrl(jid, 'image');
                if (picUrl) {
                    livePic = picUrl;
                    // Update in DB
                    await prisma.contact.updateMany({
                        where: { sessionId: dbSessionId, jid },
                        data: { profilePic: picUrl }
                    });
                }
            } catch (err) {
                // Ignore errors from profilePictureUrl (usually 404/no pic set)
            }
        }

        const contact = await prisma.contact.findFirst({
            where: {
                sessionId: dbSessionId,
                OR: [
                    { jid },
                    { lid: jid },
                    { remoteJidAlt: jid }
                ]
            }
        });

        const phone = jid.split("@")[0];
        return {
            isGroup: false,
            jid,
            phone,
            name: contact?.name || contact?.notify || null,
            notify: contact?.notify || null,
            verifiedName: contact?.verifiedName || null,
            profilePic: livePic || contact?.profilePic || null,
            createdAt: contact?.createdAt ? contact.createdAt.toISOString() : null,
            updatedAt: contact?.updatedAt ? contact.updatedAt.toISOString() : null
        };
    }
}
