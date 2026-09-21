import { Authflow } from 'prismarine-auth'
import { XboxClient, SessionDirectory, XboxRTA, PlayFabClient } from '..'

const auth = new Authflow('example')
const title = { titleId: '123', scid: 'example-scid', templateName: 'ExampleLobby' }
const client = new XboxClient(auth, title)
client.get<{ id: string }>('https://profile.xboxlive.com/users/me/settings', {
  signal: new AbortController().signal,
  timeout: 1000
}).then(value => value?.id.toUpperCase())
const session = new SessionDirectory(auth, title)
session.on('error', console.error)
session.createSession(({ profile }) => ({ custom: { owner: profile.id } }))
session.client.getSessions('123').then(handles => handles[0].sessionRef.name)
session.joinSession('example')
session.updateSession({ properties: { custom: { mode: 'example' } } })
session.invitePlayer('123')
session.end()
// @ts-expect-error Title configuration is required for managed sessions.
new SessionDirectory(auth)
const rta = new XboxRTA(auth)
rta.connect({ timeout: 1000 })
rta.subscribe<{ ConnectionId: string }>('https://sessiondirectory.xboxlive.com/connections/')
  .then(sub => rta.unsubscribe(sub.subscriptionId))
rta.on('event', event => console.log(event.subscriptionId))
rta.destroy()
const playfab = new PlayFabClient(async () => ({ SessionTicket: 'ticket' }), { titleId: 'ABC' })
playfab.request<{ AccountInfo: object }>('Client/GetAccountInfo').then(data => data?.AccountInfo)
playfab.request('Events/WriteEvents', {}, { auth: 'entity' })
// @ts-expect-error PlayFab configuration must specify a title.
new PlayFabClient(() => ({}), {})
