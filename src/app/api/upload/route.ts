import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import { getAuthenticatedUser } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user || user.role !== "SUPERADMIN") {
        return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
    }

    try {
        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ status: false, message: "No file uploaded" }, { status: 400 });
        }

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Create public/uploads directory if not exists
        const uploadDir = path.join(process.cwd(), "public", "uploads");
        if (!existsSync(uploadDir)) {
            await mkdir(uploadDir, { recursive: true });
        }

        // Generate safe unique filename
        const ext = path.extname(file.name).toLowerCase();
        const nameWithoutExt = path.basename(file.name, ext).replace(/[^a-zA-Z0-9-_]/g, "");
        const filename = `${nameWithoutExt}-${Date.now()}${ext}`;
        const filePath = path.join(uploadDir, filename);

        await writeFile(filePath, buffer);

        const fileUrl = `/uploads/${filename}`;
        return NextResponse.json({ 
            status: true, 
            message: "File uploaded successfully", 
            url: fileUrl 
        });
    } catch (error: any) {
        console.error("Upload error:", error);
        return NextResponse.json({ status: false, message: "Upload failed", error: error.message }, { status: 500 });
    }
}
