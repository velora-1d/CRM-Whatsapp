import { WhatsAppProvider, SendResult } from './provider'
import * as metaApi from './meta-api'

export class MetaWhatsAppProvider implements WhatsAppProvider {
  private phoneNumberId: string
  private accessToken: string

  constructor(phoneNumberId: string, accessToken: string) {
    this.phoneNumberId = phoneNumberId
    this.accessToken = accessToken
  }

  async sendTextMessage(
    to: string,
    text: string,
    contextMessageId?: string
  ): Promise<SendResult> {
    return metaApi.sendTextMessage({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to,
      text,
      contextMessageId,
    })
  }

  async sendTemplateMessage(
    to: string,
    templateName: string,
    language: string,
    params?: string[],
    contextMessageId?: string
  ): Promise<SendResult> {
    return metaApi.sendTemplateMessage({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to,
      templateName,
      language,
      params,
      contextMessageId,
    })
  }

  async sendReactionMessage(
    to: string,
    targetMessageId: string,
    emoji: string
  ): Promise<SendResult> {
    return metaApi.sendReactionMessage({
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
      to,
      targetMessageId,
      emoji,
    })
  }

  async downloadMedia(mediaId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const { url } = await metaApi.getMediaUrl({
      mediaId,
      accessToken: this.accessToken,
    })
    return metaApi.downloadMedia({
      downloadUrl: url,
      accessToken: this.accessToken,
    })
  }

  async verifyCredentials(): Promise<boolean> {
    try {
      const info = await metaApi.verifyPhoneNumber({
        phoneNumberId: this.phoneNumberId,
        accessToken: this.accessToken,
      })
      return !!info.id
    } catch (error) {
      console.error('Meta credentials verification failed:', error)
      return false
    }
  }
}
