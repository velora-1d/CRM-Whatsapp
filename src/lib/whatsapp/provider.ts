export interface SendResult {
  messageId: string
}

export interface WhatsAppProvider {
  sendTextMessage(
    to: string,
    text: string,
    contextMessageId?: string
  ): Promise<SendResult>

  sendTemplateMessage(
    to: string,
    templateName: string,
    language: string,
    params?: string[],
    contextMessageId?: string
  ): Promise<SendResult>

  sendReactionMessage(
    to: string,
    targetMessageId: string,
    emoji: string
  ): Promise<SendResult>

  downloadMedia(mediaId: string): Promise<{ buffer: Buffer; contentType: string }>

  verifyCredentials(): Promise<boolean>
}
