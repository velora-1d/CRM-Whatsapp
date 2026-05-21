import { NextResponse } from 'next/server'
import { db } from '@/db'
import { whatsappConfig } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { WhatsAppProviderFactory } from '@/lib/whatsapp/factory'
import { MetaWhatsAppProvider } from '@/lib/whatsapp/meta-provider'
import { EvolutionWhatsAppProvider } from '@/lib/whatsapp/evolution-provider'

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases.
 */
export async function GET() {
  try {
    const session = await auth()
    const userId = session?.user?.id

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const config = await db.query.whatsappConfig.findFirst({
      where: eq(whatsappConfig.userId, userId)
    })

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    // Try to decrypt the stored tokens.
    try {
      if (config.providerType === 'evolution') {
        if (config.evolutionInstanceToken) {
          decrypt(config.evolutionInstanceToken)
        }
      } else {
        if (config.accessToken) {
          decrypt(config.accessToken)
        }
      }
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    // Initialize provider and verify connection status
    const provider = await WhatsAppProviderFactory.getProvider(userId)
    if (!provider) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'failed_init',
          message: 'Failed to initialize active WhatsApp provider. Please re-check your configuration.',
        },
        { status: 200 }
      )
    }

    const isConnected = await provider.verifyCredentials()
    if (!isConnected) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'api_verification_failed',
          message: 'WhatsApp API rejected the credentials. Please verify your instance or token.',
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      connected: true,
      provider_type: config.providerType,
      phone_info: config.providerType === 'meta' ? { id: config.phoneNumberId } : null,
      instance_name: config.providerType === 'evolution' ? config.evolutionInstanceName : null,
    })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Saves or updates the WhatsApp config for the authenticated user.
 * Verifies credentials first, then encrypts and stores.
 */
export async function POST(request: Request) {
  try {
    const session = await auth()
    const userId = session?.user?.id

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      provider_type = 'meta',
      phone_number_id,
      waba_id,
      access_token,
      verify_token,
      evolution_instance_name,
      evolution_instance_token,
    } = body

    if (provider_type === 'meta') {
      if (!access_token || !phone_number_id) {
        return NextResponse.json(
          { error: 'access_token and phone_number_id are required for Meta provider' },
          { status: 400 }
        )
      }
    } else if (provider_type === 'evolution') {
      if (!evolution_instance_name || !evolution_instance_token) {
        return NextResponse.json(
          { error: 'evolution_instance_name and evolution_instance_token are required for Evolution provider' },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid provider_type. Allowed: meta, evolution' },
        { status: 400 }
      )
    }

    // Verify credentials BEFORE saving
    let isConnected = false
    try {
      if (provider_type === 'meta') {
        const provider = new MetaWhatsAppProvider(phone_number_id, access_token)
        isConnected = await provider.verifyCredentials()
      } else {
        const provider = new EvolutionWhatsAppProvider(evolution_instance_name, evolution_instance_token)
        isConnected = await provider.verifyCredentials()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'WhatsApp API error'
      return NextResponse.json(
        { error: `WhatsApp API error: ${message}` },
        { status: 400 }
      )
    }

    if (!isConnected) {
      return NextResponse.json(
        { error: 'Verification failed. Please check credentials or API endpoint.' },
        { status: 400 }
      )
    }

    // Encrypt sensitive tokens
    let encryptedAccessToken: string | null = null
    let encryptedVerifyToken: string | null = null
    let encryptedEvoToken: string | null = null

    try {
      if (provider_type === 'meta') {
        encryptedAccessToken = encrypt(access_token)
        encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
      } else {
        encryptedEvoToken = encrypt(evolution_instance_token)
      }
    } catch (err) {
      console.error('Encryption failed:', err)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in environment variables.',
        },
        { status: 500 }
      )
    }

    // Upsert using Drizzle
    await db
      .insert(whatsappConfig)
      .values({
        userId,
        providerType: provider_type,
        phoneNumberId: provider_type === 'meta' ? phone_number_id : null,
        wabaId: provider_type === 'meta' ? (waba_id || null) : null,
        accessToken: encryptedAccessToken,
        verifyToken: encryptedVerifyToken,
        evolutionInstanceName: provider_type === 'evolution' ? evolution_instance_name : null,
        evolutionInstanceToken: encryptedEvoToken,
        status: 'connected',
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [whatsappConfig.userId],
        set: {
          providerType: provider_type,
          phoneNumberId: provider_type === 'meta' ? phone_number_id : null,
          wabaId: provider_type === 'meta' ? (waba_id || null) : null,
          accessToken: encryptedAccessToken,
          verifyToken: encryptedVerifyToken,
          evolutionInstanceName: provider_type === 'evolution' ? evolution_instance_name : null,
          evolutionInstanceToken: encryptedEvoToken,
          status: 'connected',
          connectedAt: new Date(),
          updatedAt: new Date(),
        }
      })

    return NextResponse.json({
      success: true,
      provider_type,
      instance_name: provider_type === 'evolution' ? evolution_instance_name : null,
    })
  } catch (error) {
    console.error('Error in WhatsApp config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 */
export async function DELETE() {
  try {
    const session = await auth()
    const userId = session?.user?.id

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await db
      .delete(whatsappConfig)
      .where(eq(whatsappConfig.userId, userId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
