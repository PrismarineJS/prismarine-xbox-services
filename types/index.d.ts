import { EventEmitter } from 'events'

/** Implemented by prismarine-auth's Authflow. Authentication remains caller-owned. */
export interface XboxTokenProvider {
  getXboxToken(relyingParty?: string, forceRefresh?: boolean): Promise<{ userHash: string; XSTSToken: string }>
}
export interface OperationOptions {
  timeout?: number
  signal?: AbortSignal
}
export interface XboxOptions {
  titleId?: string
  scid?: string
  templateName?: string
  timeout?: number
  cleanupTimeout?: number
}
export type UserIdentifier = 'me' | { xuid: string; gamertag?: never } | { gamertag: string; xuid?: never }
export interface RequestOptions extends OperationOptions {
  data?: unknown
  headers?: Record<string, string>
  contractVersion?: string
}
export interface Profile {
  xuid: string
  gamertag?: string
  displayName?: string
  avatarUrl?: string
}
export interface SessionProperties {
  system?: Record<string, unknown>
  custom?: Record<string, unknown>
}
export interface SessionDocument {
  members?: Record<string, SessionMember | null>
  properties: SessionProperties
  [key: string]: unknown
}
export interface SessionReference {
  scid: string
  templateName: string
  name: string
}
export interface ActivityHandle {
  sessionRef: SessionReference
  [key: string]: unknown
}
export interface JoinSessionOptions extends OperationOptions {
  publishActivity?: boolean
}
export interface CreateSessionOptions extends JoinSessionOptions {
  name?: string
  properties?: SessionProperties | ((context: { profile: Profile }) => SessionProperties | Promise<SessionProperties>)
}
export function createXboxClient(auth: XboxTokenProvider, options?: XboxOptions): XboxClient
export interface XboxClient {
  request<T = unknown>(method: string, url: string, options?: RequestOptions): Promise<T | undefined>
  abortPending(): void
  getProfile(identifier?: UserIdentifier, options?: OperationOptions): Promise<Profile>
  getActivityHandles(xuid: string, options?: OperationOptions): Promise<ActivityHandle[]>
  getSession(name: string, options?: OperationOptions): Promise<SessionDocument>
  updateSession(name: string, payload: Record<string, unknown>, options?: OperationOptions): Promise<unknown>
  setActivity(name: string, options?: OperationOptions): Promise<unknown>
  sendInvite(name: string, xuid: string, options?: OperationOptions): Promise<unknown>
  createSession(options?: CreateSessionOptions): Promise<XboxSession>
  joinSession(name: string, options?: JoinSessionOptions): Promise<XboxSession>
}
export interface SessionMember {
  constants?: { system?: { xuid?: string; [key: string]: unknown } }
  [key: string]: unknown
}
export interface XboxSession extends EventEmitter<{
  changed: [current: SessionDocument, previous: SessionDocument]
  memberJoin: [member: SessionMember]
  memberLeave: [member: SessionMember]
  propertiesChanged: [properties: SessionProperties]
  error: [error: Error]
  close: []
}> {
  readonly name: string
  readonly state: 'opening' | 'open' | 'closing' | 'closed'
  readonly snapshot: SessionDocument
  setActivity(options?: OperationOptions): Promise<void>
  get(options?: OperationOptions): Promise<SessionDocument>
  updateProperties(properties: SessionProperties, options?: OperationOptions): Promise<void>
  invite(identifier: UserIdentifier, options?: OperationOptions): Promise<void>
  close(): Promise<void>
}
export interface RtaSubscription<T = unknown> extends EventEmitter<{ ready: [data: T]; data: [data: T] }> {
  readonly uri: string
  readonly data: T
  readonly closed: boolean
  close(): Promise<void>
}
export function connectRta(auth: XboxTokenProvider, options?: OperationOptions): Promise<RtaConnection>
export interface RtaConnection extends EventEmitter<{
  resync: []
  disconnect: [code: number, reason: string]
  error: [error: Error]
  close: []
}> {
  reconnect(options?: OperationOptions): Promise<void>
  subscribe<T = unknown>(uri: string, options?: OperationOptions): Promise<RtaSubscription<T>>
  close(): Promise<void>
}
export class ServiceError extends Error {
  constructor(service: string, status: number, body: string, details?: { error?: string; errorMessage?: string; errorCode?: number; errorDetails?: Record<string, unknown> })
  readonly service: string
  readonly status: number
  readonly body: string
  readonly code?: string
  readonly errorCode?: number
  readonly details?: Record<string, unknown>
}
export interface PlayFabCredentials {
  SessionTicket?: string
  EntityToken?: { EntityToken: string }
}
export interface PlayFabOptions {
  titleId: string
  timeout?: number
}
export interface PlayFabRequestOptions extends OperationOptions {
  auth?: 'session' | 'entity'
}
export interface CloudScriptOptions {
  functionName: string
  functionParameter?: unknown
  generatePlayStreamEvent?: boolean
  revisionSelection?: 'Live' | 'Latest' | 'Specific'
  specificRevision?: number
}
export interface TitleData { Data?: Record<string, string> }
export interface UserInventory { Inventory?: Record<string, unknown>[]; [key: string]: unknown }
export interface CloudScriptResult { FunctionResult?: unknown; Error?: Record<string, unknown>; [key: string]: unknown }
export function createPlayFabClient(getCredentials: () => PlayFabCredentials | Promise<PlayFabCredentials>, options: PlayFabOptions): PlayFabClient
export interface PlayFabClient {
  getTitleData(query?: { keys?: string[] }, options?: OperationOptions): Promise<TitleData | undefined>
  getUserInventory(options?: OperationOptions): Promise<UserInventory | undefined>
  executeCloudScript(input: CloudScriptOptions, options?: OperationOptions): Promise<CloudScriptResult | undefined>
  request<T = unknown>(path: string, data?: unknown, options?: PlayFabRequestOptions): Promise<T | undefined>
  abortPending(): void
}
