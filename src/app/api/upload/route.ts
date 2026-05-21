import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { auth } from '@/auth'

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 })
    }

    // Validasi tipe file
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Format file tidak didukung' }, { status: 400 })
    }

    // Validasi ukuran (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Ukuran file maksimal 2MB' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Buat direktori penyimpanan jika belum ada
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'avatars')
    await fs.mkdir(uploadDir, { recursive: true })

    // Generate nama file unik
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const fileName = `avatar-${session.user.id}-${Date.now()}.${ext}`
    const filePath = path.join(uploadDir, fileName)

    // Tulis file ke disk
    await fs.writeFile(filePath, buffer)

    // Kembalikan public URL
    const publicUrl = `/uploads/avatars/${fileName}`
    return NextResponse.json({ url: publicUrl })
  } catch (error: any) {
    console.error('File upload error:', error)
    return NextResponse.json({ error: error.message || 'Gagal mengunggah file' }, { status: 500 })
  }
}
