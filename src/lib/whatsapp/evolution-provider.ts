import { WhatsAppProvider, SendResult } from './provider'
import { sanitizePhoneForMeta } from './phone-utils'
import { db } from '@/db'
import { messageTemplates } from '@/db/schema'
import { eq } from 'drizzle-orm'

export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  private instanceName: string
  private instanceToken: string
  private baseUrl: string

  constructor(instanceName: string, instanceToken: string) {
    this.instanceName = instanceName
    this.instanceToken = instanceToken
    this.baseUrl = process.env.EVOLUTION_API_URL || ''
  }

  private getUrl(endpoint: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${endpoint}`
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.instanceToken,
    }
  }

  async sendTextMessage(
    to: string,
    text: string,
    contextMessageId?: string
  ): Promise<SendResult> {
    const cleanNumber = sanitizePhoneForMeta(to)
    const url = this.getUrl(`/message/sendText/${this.instanceName}`)
    const payload: Record<string, any> = {
      number: cleanNumber,
      textMessage: {
        text: text,
      },
      options: {
        delay: 1200,
        presence: 'composing',
      },
    }

    if (contextMessageId) {
      payload.options.quoted = {
        key: {
          id: contextMessageId,
        },
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Evolution API sendText error: ${response.statusText}`)
    }

    const resData = await response.json()
    const messageId = resData?.key?.id || resData?.messageId || `evo-${Date.now()}`
    return { messageId }
  }

  async sendTemplateMessage(
    to: string,
    templateName: string,
    language: string,
    params?: string[],
    contextMessageId?: string
  ): Promise<SendResult> {
    // Cari bodyText dari template di DB
    let bodyText = `Template: ${templateName}`
    try {
      const template = await db.query.messageTemplates.findFirst({
        where: eq(messageTemplates.name, templateName),
      })
      if (template) {
        bodyText = template.bodyText
        if (params && params.length > 0) {
          params.forEach((param, index) => {
            bodyText = bodyText.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), param)
          })
        }
      }
    } catch (e) {
      console.error('Gagal mengambil template untuk Evolution API, fallback ke teks generic:', e)
    }

    return this.sendTextMessage(to, bodyText, contextMessageId)
  }

  async sendReactionMessage(
    to: string,
    targetMessageId: string,
    emoji: string
  ): Promise<SendResult> {
    const cleanNumber = sanitizePhoneForMeta(to)
    const url = this.getUrl(`/message/sendReaction/${this.instanceName}`)
    const payload = {
      reactionMessage: {
        key: {
          remoteJid: `${cleanNumber}@s.whatsapp.net`,
          fromMe: false,
          id: targetMessageId,
        },
        text: emoji,
      },
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Evolution API sendReaction error: ${response.statusText}`)
    }

    const resData = await response.json()
    const messageId = resData?.key?.id || resData?.messageId || `evo-rx-${Date.now()}`
    return { messageId }
  }

  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (mediaId.startsWith('http')) {
      const response = await fetch(mediaId, {
        headers: this.getHeaders(),
      })
      if (!response.ok) {
        throw new Error(`Gagal mengunduh media: ${response.statusText}`)
      }
      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const buffer = Buffer.from(await response.arrayBuffer())
      return { buffer, contentType }
    }

    const url = this.getUrl(`/chat/getBase64FromMediaMessage/${this.instanceName}`)
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message: {
          key: {
            id: mediaId,
          },
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Gagal mengunduh media dari Evolution API: ${response.statusText}`)
    }

    const resData = await response.json()
    const base64 = resData?.base64
    if (!base64) {
      throw new Error('Evolution API tidak mengembalikan data base64 untuk media')
    }

    const mime = resData?.mime || 'application/octet-stream'
    const buffer = Buffer.from(base64, 'base64')
    return { buffer, contentType: mime }
  }

  async verifyCredentials(): Promise<boolean> {
    try {
      const url = this.getUrl(`/instance/connectionState/${this.instanceName}`)
      const response = await fetch(url, {
        headers: this.getHeaders(),
      })
      if (!response.ok) {
        return false
      }
      const data = await response.json()
      const state = data?.instance?.state || data?.state || data?.instance?.connectionState
      return state === 'open' || state === 'connected'
    } catch (error) {
      console.error('Evolution credentials verification failed:', error)
      return false
    }
  }
}
