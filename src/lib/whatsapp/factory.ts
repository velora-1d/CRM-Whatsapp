import { db } from '@/db'
import { whatsappConfig } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from './encryption'
import { WhatsAppProvider } from './provider'
import { MetaWhatsAppProvider } from './meta-provider'
import { EvolutionWhatsAppProvider } from './evolution-provider'

export class WhatsAppProviderFactory {
  /**
   * Mengambil dan menginstansiasi WhatsAppProvider yang aktif berdasarkan konfigurasi pengguna.
   * Mendukung 'meta' dan 'evolution' provider.
   */
  static async getProvider(userId: string): Promise<WhatsAppProvider | null> {
    const config = await db.query.whatsappConfig.findFirst({
      where: eq(whatsappConfig.userId, userId),
    })

    if (!config) {
      return null
    }

    try {
      if (config.providerType === 'evolution') {
        if (!config.evolutionInstanceName || !config.evolutionInstanceToken) {
          return null
        }
        const decryptedToken = decrypt(config.evolutionInstanceToken)
        return new EvolutionWhatsAppProvider(config.evolutionInstanceName, decryptedToken)
      } else {
        if (!config.phoneNumberId || !config.accessToken) {
          return null
        }
        const decryptedToken = decrypt(config.accessToken)
        return new MetaWhatsAppProvider(config.phoneNumberId, decryptedToken)
      }
    } catch (err) {
      console.error('[WhatsAppProviderFactory] Gagal menginisialisasi provider:', err)
      return null
    }
  }
}
