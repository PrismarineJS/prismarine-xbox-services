import { EventEmitter } from 'events'
/** Structural interface implemented by prismarine-auth's Authflow. */
export interface XboxTokenProvider {
  getXboxToken(relyingParty?: string, forceRefresh?: boolean): Promise<{ userHash: string; XSTSToken: string }>
}

/** Experimental API: coordinate updates with consumers. */
export interface TitleOptions {
  titleId: string
  scid: string
  templateName: string
  timeout?: number
}
export interface RequestOptions {
  data?: unknown
  headers?: Record<string, string>
  contractVersion?: string
  timeout?: number
  signal?: AbortSignal
}
export interface Profile {
  id: string
  [key: string]: unknown
}
export interface SessionProperties {
  system?: Record<string, unknown>
  custom?: Record<string, unknown>
}
export interface Session {
  properties: SessionProperties
  [key: string]: unknown
}
export interface SessionHandle {
  sessionRef: { scid: string; templateName: string; name: string }
  [key: string]: unknown
}
export class XboxClient {
  constructor(authflow: XboxTokenProvider, options?: Partial<TitleOptions>)
  get<T = unknown>(url: string, config?: RequestOptions): Promise<T | undefined>
  post<T = unknown>(url: string, config?: RequestOptions): Promise<T | undefined>
  put<T = unknown>(url: string, config?: RequestOptions): Promise<T | undefined>
  delete<T = unknown>(url: string, config?: RequestOptions): Promise<T | undefined>
  abortPending(): void
  getProfile(identifier: string): Promise<Profile>
  getSessions(xuid: string): Promise<SessionHandle[]>
  getSession(name: string): Promise<Session>
  updateSession(name: string, payload: Record<string, unknown>): Promise<unknown>
  setActivity(name: string): Promise<unknown>
  sendInvite(name: string, xuid: string): Promise<unknown>
  leaveSession(name: string): Promise<void>
  sessionRef(name: string): SessionHandle['sessionRef']
  sessionUrl(name: string): string
  sendHandle(payload: Record<string, unknown>): Promise<unknown>
  addConnection(name: string, xuid: string, connectionId: string, subscriptionId: string): Promise<void>
  updateConnection(name: string, connectionId: string): Promise<void>
}
export class SessionDirectory extends EventEmitter {
  constructor(authflow: XboxTokenProvider, options: TitleOptions)
  /** This client belongs to this session; end() cancels its pending requests. */
  readonly client: XboxClient
  readonly name: string
  readonly profile: Profile | null
  readonly connectionId: string | null
  readonly rta: XboxRTA | null
  createSession(properties?: SessionProperties | ((context: { profile: Profile }) => SessionProperties)): Promise<void>
  joinSession(name: string): Promise<Session>
  getSession(): Promise<Session>
  updateSession(payload: Record<string, unknown>): Promise<void>
  invitePlayer(identifier: string): Promise<void>
  end(): Promise<void>
}

export interface ConnectionOptions {
  timeout?: number
  signal?: AbortSignal
}
export interface SubscribeResponse<T = unknown> {
  type: number
  sequenceId: number
  status: number
  subscriptionId: number
  data: T
  uri: string | null
}
export interface UnsubscribeResponse {
  type: number
  sequenceId: number
  status: number
}
export interface EventResponse<T = unknown> {
  type: number
  subscriptionId: number
  data: T
}
export class XboxRTA extends EventEmitter {
  constructor(authflow: XboxTokenProvider)
  readonly subscriptions: ReadonlyMap<number, SubscribeResponse>
  connect(options?: ConnectionOptions): Promise<void>
  subscribe<T = unknown>(uri: string): Promise<SubscribeResponse<T>>
  unsubscribe(subscriptionId: number): Promise<UnsubscribeResponse>
  destroy(resume?: boolean): Promise<void>
  on(event: 'subscribe', listener: (response: SubscribeResponse) => void): this
  on(event: 'unsubscribe', listener: (response: UnsubscribeResponse) => void): this
  on(event: 'event', listener: (response: EventResponse) => void): this
  on(event: 'resync', listener: () => void): this
  on(event: 'close', listener: (code: number, reason: string) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: string | symbol, listener: (...args: any[]) => void): this
}
export interface PlayFabCredentials {
  SessionTicket?: string
  EntityToken?: { EntityToken: string }
}
export interface PlayFabOptions {
  titleId: string
  timeout?: number
}
export interface PlayFabRequestOptions extends ConnectionOptions {
  auth?: 'session' | 'entity'
}
export class PlayFabClient {
  constructor(getCredentials: () => PlayFabCredentials | Promise<PlayFabCredentials>, options: PlayFabOptions)
  request<T = unknown>(path: string, data?: unknown, options?: PlayFabRequestOptions): Promise<T | undefined>
  abortPending(): void
}
