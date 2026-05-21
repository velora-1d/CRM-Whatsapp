import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  jsonb,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'

// ============================================================
// USERS (NextAuth & Credentials Login)
// ============================================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const usersRelations = relations(users, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [users.id],
    references: [profiles.userId],
  }),
  contacts: many(contacts),
  tags: many(tags),
  customFields: many(customFields),
  conversations: many(conversations),
  whatsappConfig: one(whatsappConfig, {
    fields: [users.id],
    references: [whatsappConfig.userId],
  }),
  messageTemplates: many(messageTemplates),
  pipelines: many(pipelines),
  deals: many(deals),
  broadcasts: many(broadcasts),
  automations: many(automations),
  automationLogs: many(automationLogs),
  automationPendingExecutions: many(automationPendingExecutions),
}))

// ============================================================
// PROFILES
// ============================================================
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  avatarUrl: text('avatar_url'),
  role: text('role').default('user'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.userId],
    references: [users.id],
  }),
}))

// ============================================================
// CONTACTS
// ============================================================
export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  name: text('name'),
  email: text('email'),
  company: text('company'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_contacts_user_id').on(table.userId),
  index('idx_contacts_phone').on(table.phone),
])

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  user: one(users, {
    fields: [contacts.userId],
    references: [users.id],
  }),
  contactTags: many(contactTags),
  customValues: many(contactCustomValues),
  notes: many(contactNotes),
  conversations: many(conversations),
  deals: many(deals),
  broadcastRecipients: many(broadcastRecipients),
  automationLogs: many(automationLogs),
  automationPendingExecutions: many(automationPendingExecutions),
}))

// ============================================================
// TAGS
// ============================================================
export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#3b82f6'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const tagsRelations = relations(tags, ({ one, many }) => ({
  user: one(users, {
    fields: [tags.userId],
    references: [users.id],
  }),
  contactTags: many(contactTags),
}))

// ============================================================
// CONTACT_TAGS (many-to-many)
// ============================================================
export const contactTags = pgTable('contact_tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_contact_tags_contact').on(table.contactId),
  index('idx_contact_tags_tag').on(table.tagId),
  uniqueIndex('idx_contact_tags_unique').on(table.contactId, table.tagId),
])

export const contactTagsRelations = relations(contactTags, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactTags.contactId],
    references: [contacts.id],
  }),
  tag: one(tags, {
    fields: [contactTags.tagId],
    references: [tags.id],
  }),
}))

// ============================================================
// CUSTOM_FIELDS
// ============================================================
export const customFields = pgTable('custom_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  fieldName: text('field_name').notNull(),
  fieldType: text('field_type').notNull().default('text'),
  fieldOptions: jsonb('field_options'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const customFieldsRelations = relations(customFields, ({ one, many }) => ({
  user: one(users, {
    fields: [customFields.userId],
    references: [users.id],
  }),
  values: many(contactCustomValues),
}))

// ============================================================
// CONTACT_CUSTOM_VALUES
// ============================================================
export const contactCustomValues = pgTable('contact_custom_values', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  customFieldId: uuid('custom_field_id')
    .notNull()
    .references(() => customFields.id, { onDelete: 'cascade' }),
  value: text('value'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idx_contact_custom_values_unique').on(table.contactId, table.customFieldId),
])

export const contactCustomValuesRelations = relations(contactCustomValues, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactCustomValues.contactId],
    references: [contacts.id],
  }),
  customField: one(customFields, {
    fields: [contactCustomValues.customFieldId],
    references: [customFields.id],
  }),
}))

// ============================================================
// CONTACT_NOTES
// ============================================================
export const contactNotes = pgTable('contact_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  noteText: text('note_text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const contactNotesRelations = relations(contactNotes, ({ one }) => ({
  contact: one(contacts, {
    fields: [contactNotes.contactId],
    references: [contacts.id],
  }),
  user: one(users, {
    fields: [contactNotes.userId],
    references: [users.id],
  }),
}))

// ============================================================
// CONVERSATIONS
// ============================================================
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('open'), // 'open', 'pending', 'closed'
  assignedAgentId: uuid('assigned_agent_id').references(() => profiles.id, { onDelete: 'set null' }),
  lastMessageText: text('last_message_text'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  unreadCount: integer('unread_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_conversations_user_id').on(table.userId),
  index('idx_conversations_contact_id').on(table.contactId),
])

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  contact: one(contacts, {
    fields: [conversations.contactId],
    references: [contacts.id],
  }),
  assignedAgent: one(profiles, {
    fields: [conversations.assignedAgentId],
    references: [profiles.id],
  }),
  messages: many(messages),
  messageReactions: many(messageReactions),
  deals: many(deals),
}))

// ============================================================
// MESSAGES
// ============================================================
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(), // 'customer', 'agent', 'bot'
  senderId: uuid('sender_id'),
  contentType: text('content_type').notNull().default('text'), // 'text', 'image', 'document', 'audio', 'video', 'location', 'template'
  contentText: text('content_text'),
  mediaUrl: text('media_url'),
  templateName: text('template_name'),
  messageId: text('message_id'),
  status: text('status').notNull().default('sent'), // 'sending', 'sent', 'delivered', 'read', 'failed'
  replyToMessageId: uuid('reply_to_message_id').references((): any => messages.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_messages_conversation').on(table.conversationId),
  index('idx_messages_message_id').on(table.messageId),
  index('idx_messages_reply_to').on(table.replyToMessageId),
])

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  replyTo: one(messages, {
    fields: [messages.replyToMessageId],
    references: [messages.id],
    relationName: 'replies',
  }),
  replies: many(messages, { relationName: 'replies' }),
  reactions: many(messageReactions),
}))

// ============================================================
// MESSAGE_REACTIONS
// ============================================================
export const messageReactions = pgTable('message_reactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: uuid('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  actorType: text('actor_type').notNull(), // 'customer', 'agent'
  actorId: uuid('actor_id'),
  emoji: text('emoji').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_message_reactions_conversation').on(table.conversationId),
  index('idx_message_reactions_message').on(table.messageId),
  uniqueIndex('idx_message_reactions_unique').on(table.messageId, table.actorType, table.actorId),
])

export const messageReactionsRelations = relations(messageReactions, ({ one }) => ({
  message: one(messages, {
    fields: [messageReactions.messageId],
    references: [messages.id],
  }),
  conversation: one(conversations, {
    fields: [messageReactions.conversationId],
    references: [conversations.id],
  }),
}))

// ============================================================
// WHATSAPP_CONFIG
// ============================================================
export const whatsappConfig = pgTable('whatsapp_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  phoneNumberId: text('phone_number_id'),
  wabaId: text('waba_id'),
  accessToken: text('access_token'),
  verifyToken: text('verify_token'),
  status: text('status').notNull().default('disconnected'), // 'connected', 'disconnected'
  connectedAt: timestamp('connected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  
  // Flexible WhatsApp Provider Additions
  providerType: text('provider_type').notNull().default('meta'), // 'meta', 'evolution'
  evolutionInstanceName: text('evolution_instance_name'),
  evolutionInstanceToken: text('evolution_instance_token'), // will be encrypted
})

export const whatsappConfigRelations = relations(whatsappConfig, ({ one }) => ({
  user: one(users, {
    fields: [whatsappConfig.userId],
    references: [users.id],
  }),
}))

// ============================================================
// MESSAGE_TEMPLATES
// ============================================================
export const messageTemplates = pgTable('message_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').notNull().default('Marketing'), // 'Marketing', 'Utility', 'Authentication'
  language: text('language').default('en_US'),
  headerType: text('header_type'), // 'text', 'image', 'video', 'document'
  headerContent: text('header_content'),
  bodyText: text('body_text').notNull(),
  footerText: text('footer_text'),
  buttons: jsonb('buttons'),
  status: text('status').default('Draft'), // 'Draft', 'Pending', 'Approved', 'Rejected'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const messageTemplatesRelations = relations(messageTemplates, ({ one }) => ({
  user: one(users, {
    fields: [messageTemplates.userId],
    references: [users.id],
  }),
}))

// ============================================================
// PIPELINES
// ============================================================
export const pipelines = pgTable('pipelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  user: one(users, {
    fields: [pipelines.userId],
    references: [users.id],
  }),
  stages: many(pipelineStages),
  deals: many(deals),
}))

// ============================================================
// PIPELINE_STAGES
// ============================================================
export const pipelineStages = pgTable('pipeline_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  pipelineId: uuid('pipeline_id')
    .notNull()
    .references(() => pipelines.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  color: text('color').notNull().default('#3b82f6'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_pipeline_stages_pipeline').on(table.pipelineId),
])

export const pipelineStagesRelations = relations(pipelineStages, ({ one, many }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineStages.pipelineId],
    references: [pipelines.id],
  }),
  deals: many(deals),
}))

// ============================================================
// DEALS
// ============================================================
export const deals = pgTable('deals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  pipelineId: uuid('pipeline_id')
    .notNull()
    .references(() => pipelines.id, { onDelete: 'cascade' }),
  stageId: uuid('stage_id')
    .notNull()
    .references(() => pipelineStages.id),
  contactId: uuid('contact_id')
    .references(() => contacts.id, { onDelete: 'set null' }),
  conversationId: uuid('conversation_id').references(() => conversations.id),
  title: text('title').notNull(),
  value: numeric('value', { precision: 12, scale: 2 }).notNull().default('0'),
  currency: text('currency').default('USD'),
  notes: text('notes'),
  expectedCloseDate: date('expected_close_date'),
  status: text('status').default('open'), // 'open', 'won', 'lost'
  assignedTo: uuid('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_deals_pipeline').on(table.pipelineId),
  index('idx_deals_stage').on(table.stageId),
  index('idx_deals_assigned_to').on(table.assignedTo),
])

export const dealsRelations = relations(deals, ({ one }) => ({
  user: one(users, {
    fields: [deals.userId],
    references: [users.id],
  }),
  pipeline: one(pipelines, {
    fields: [deals.pipelineId],
    references: [pipelines.id],
  }),
  stage: one(pipelineStages, {
    fields: [deals.stageId],
    references: [pipelineStages.id],
  }),
  contact: one(contacts, {
    fields: [deals.contactId],
    references: [contacts.id],
  }),
  conversation: one(conversations, {
    fields: [deals.conversationId],
    references: [conversations.id],
  }),
  assignedAgent: one(profiles, {
    fields: [deals.assignedTo],
    references: [profiles.id],
  }),
}))

// ============================================================
// BROADCASTS
// ============================================================
export const broadcasts = pgTable('broadcasts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  templateName: text('template_name').notNull(),
  templateLanguage: text('template_language').notNull().default('en_US'),
  templateVariables: jsonb('template_variables'),
  audienceFilter: jsonb('audience_filter'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  status: text('status').notNull().default('draft'), // 'draft', 'scheduled', 'sending', 'sent', 'failed'
  totalRecipients: integer('total_recipients').default(0),
  sentCount: integer('sent_count').default(0),
  deliveredCount: integer('delivered_count').default(0),
  readCount: integer('read_count').default(0),
  repliedCount: integer('replied_count').default(0),
  failedCount: integer('failed_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const broadcastsRelations = relations(broadcasts, ({ one, many }) => ({
  user: one(users, {
    fields: [broadcasts.userId],
    references: [users.id],
  }),
  recipients: many(broadcastRecipients),
}))

// ============================================================
// BROADCAST_RECIPIENTS
// ============================================================
export const broadcastRecipients = pgTable('broadcast_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  broadcastId: uuid('broadcast_id')
    .notNull()
    .references(() => broadcasts.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .references(() => contacts.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'), // 'pending', 'sent', 'delivered', 'read', 'replied', 'failed'
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  readAt: timestamp('read_at', { withTimezone: true }),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  whatsappMessageId: text('whatsapp_message_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_broadcast_recipients_broadcast').on(table.broadcastId),
  index('idx_broadcast_recipients_broadcast_status').on(table.broadcastId, table.status),
  uniqueIndex('idx_broadcast_recipients_wamid')
    .on(table.whatsappMessageId)
    .where(sql`whatsapp_message_id IS NOT NULL`),
])

export const broadcastRecipientsRelations = relations(broadcastRecipients, ({ one }) => ({
  broadcast: one(broadcasts, {
    fields: [broadcastRecipients.broadcastId],
    references: [broadcasts.id],
  }),
  contact: one(contacts, {
    fields: [broadcastRecipients.contactId],
    references: [contacts.id],
  }),
}))

// ============================================================
// AUTOMATIONS
// ============================================================
export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: text('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(false),
  executionCount: integer('execution_count').notNull().default(0),
  lastExecutedAt: timestamp('last_executed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_automations_user_id').on(table.userId),
  index('idx_automations_active_trigger')
    .on(table.triggerType)
    .where(sql`is_active = TRUE`),
])

export const automationsRelations = relations(automations, ({ one, many }) => ({
  user: one(users, {
    fields: [automations.userId],
    references: [users.id],
  }),
  steps: many(automationSteps),
  logs: many(automationLogs),
  pendingExecutions: many(automationPendingExecutions),
}))

// ============================================================
// AUTOMATION_STEPS
// ============================================================
export const automationSteps = pgTable('automation_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  automationId: uuid('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  parentStepId: uuid('parent_step_id').references((): any => automationSteps.id, { onDelete: 'cascade' }),
  branch: text('branch'), // 'yes', 'no'
  stepType: text('step_type').notNull(),
  stepConfig: jsonb('step_config').notNull().default({}),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_automation_steps_automation_id').on(table.automationId, table.position),
  index('idx_automation_steps_parent')
    .on(table.parentStepId)
    .where(sql`parent_step_id IS NOT NULL`),
])

export const automationStepsRelations = relations(automationSteps, ({ one, many }) => ({
  automation: one(automations, {
    fields: [automationSteps.automationId],
    references: [automations.id],
  }),
  parentStep: one(automationSteps, {
    fields: [automationSteps.parentStepId],
    references: [automationSteps.id],
    relationName: 'stepBranches',
  }),
  branches: many(automationSteps, { relationName: 'stepBranches' }),
  pendingExecutions: many(automationPendingExecutions),
}))

// ============================================================
// AUTOMATION_LOGS
// ============================================================
export const automationLogs = pgTable('automation_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  automationId: uuid('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  triggerEvent: text('trigger_event').notNull(),
  stepsExecuted: jsonb('steps_executed').notNull().default([]),
  status: text('status').notNull(), // 'success', 'partial', 'failed'
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_automation_logs_automation').on(table.automationId, table.createdAt),
  index('idx_automation_logs_user').on(table.userId),
])

export const automationLogsRelations = relations(automationLogs, ({ one, many }) => ({
  automation: one(automations, {
    fields: [automationLogs.automationId],
    references: [automations.id],
  }),
  user: one(users, {
    fields: [automationLogs.userId],
    references: [users.id],
  }),
  contact: one(contacts, {
    fields: [automationLogs.contactId],
    references: [contacts.id],
  }),
  pendingExecutions: many(automationPendingExecutions),
}))

// ============================================================
// AUTOMATION_PENDING_EXECUTIONS
// ============================================================
export const automationPendingExecutions = pgTable('automation_pending_executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  automationId: uuid('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  logId: uuid('log_id').references(() => automationLogs.id, { onDelete: 'cascade' }),
  parentStepId: uuid('parent_step_id').references(() => automationSteps.id, { onDelete: 'set null' }),
  branch: text('branch'), // 'yes', 'no'
  nextStepPosition: integer('next_step_position').notNull(),
  context: jsonb('context').notNull().default({}),
  status: text('status').notNull().default('pending'), // 'pending', 'running', 'done', 'failed'
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_automation_pending_due')
    .on(table.runAt)
    .where(sql`status = 'pending'`),
])

export const automationPendingExecutionsRelations = relations(automationPendingExecutions, ({ one }) => ({
  automation: one(automations, {
    fields: [automationPendingExecutions.automationId],
    references: [automations.id],
  }),
  user: one(users, {
    fields: [automationPendingExecutions.userId],
    references: [users.id],
  }),
  contact: one(contacts, {
    fields: [automationPendingExecutions.contactId],
    references: [contacts.id],
  }),
  log: one(automationLogs, {
    fields: [automationPendingExecutions.logId],
    references: [automationLogs.id],
  }),
  parentStep: one(automationSteps, {
    fields: [automationPendingExecutions.parentStepId],
    references: [automationSteps.id],
  }),
}))
