'use server'

import { db } from '@/db'
import { users, profiles } from '@/db/schema'
import { hashPassword } from '@/lib/auth/password'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'

export async function signUpUser(formData: { email: string; fullName: string; password: string }) {
  try {
    const { email, fullName, password } = formData

    if (!email || !fullName || !password) {
      return { error: 'Semua field wajib diisi' }
    }

    if (password.length < 6) {
      return { error: 'Password minimal harus 6 karakter' }
    }

    // Periksa apakah email sudah terdaftar
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase().trim()),
    })

    if (existingUser) {
      return { error: 'Email sudah terdaftar' }
    }

    const hashedPassword = hashPassword(password)

    // Insert user dan profil dalam transaksi
    await db.transaction(async (tx) => {
      const [insertedUser] = await tx
        .insert(users)
        .values({
          email: email.toLowerCase().trim(),
          passwordHash: hashedPassword,
        })
        .returning()

      await tx.insert(profiles).values({
        userId: insertedUser.id,
        fullName: fullName.trim(),
        email: email.toLowerCase().trim(),
        role: 'user',
      })
    })

    return { success: true }
  } catch (error: any) {
    console.error('Sign up error:', error)
    return { error: error.message || 'Terjadi kesalahan saat membuat akun' }
  }
}

export async function getProfile() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.userId, session.user.id),
    })

    if (!profile) {
      return { error: 'Profile tidak ditemukan' }
    }

    const formattedProfile = {
      id: profile.id,
      user_id: profile.userId,
      full_name: profile.fullName,
      email: profile.email,
      avatar_url: profile.avatarUrl || undefined,
      role: profile.role || 'user',
      created_at: profile.createdAt.toISOString(),
    }

    return { success: true, data: formattedProfile }
  } catch (error: any) {
    console.error('Get profile error:', error)
    return { error: error.message || 'Gagal mengambil profile' }
  }
}

export async function updateProfile(formData: { fullName: string; avatarUrl: string | null; email: string }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }

    const { fullName, avatarUrl, email } = formData
    const targetEmail = email.toLowerCase().trim()

    // Ambil data user & profile saat ini
    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    })

    if (!currentUser) {
      return { error: 'User tidak ditemukan' }
    }

    // Jika email berubah, pastikan belum terdaftar oleh user lain
    if (currentUser.email !== targetEmail) {
      const emailTaken = await db.query.users.findFirst({
        where: eq(users.email, targetEmail),
      })
      if (emailTaken) {
        return { error: 'Email tersebut sudah digunakan oleh pengguna lain' }
      }
    }

    await db.transaction(async (tx) => {
      // Update table users (email)
      if (currentUser.email !== targetEmail) {
        await tx
          .update(users)
          .set({ email: targetEmail, updatedAt: new Date() })
          .where(eq(users.id, session.user.id))
      }

      // Update table profiles
      await tx
        .update(profiles)
        .set({
          fullName: fullName.trim(),
          avatarUrl: avatarUrl,
          email: targetEmail,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, session.user.id))
    })

    return { success: true }
  } catch (error: any) {
    console.error('Update profile error:', error)
    return { error: error.message || 'Gagal mengupdate profile' }
  }
}

export async function signOutUser() {
  try {
    const { signOut: nextSignOut } = await import('@/auth')
    await nextSignOut({ redirect: false })
    return { success: true }
  } catch (error: any) {
    console.error('Sign out error:', error)
    return { error: error.message || 'Gagal melakukan sign out' }
  }
}

export async function updateUserPassword(formData: { current: string; next: string }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { error: 'Unauthorized' }
    }
    const userId = session.user.id

    const userRecord = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })

    if (!userRecord) {
      return { error: 'User tidak ditemukan' }
    }

    const { verifyPassword, hashPassword } = await import('@/lib/auth/password')

    const isCurrentValid = verifyPassword(formData.current, userRecord.passwordHash)
    if (!isCurrentValid) {
      return { error: 'Password saat ini salah' }
    }

    const newHashed = hashPassword(formData.next)

    await db
      .update(users)
      .set({
        passwordHash: newHashed,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    return { success: true }
  } catch (error: any) {
    console.error('Update password error:', error)
    return { error: error.message || 'Gagal memperbarui password' }
  }
}
