import { Authflow } from 'prismarine-auth'
import { XboxClient, XboxSession, XboxRTASocket, PlayFabClient, ServiceError, SocketError, SocketClosedError, SocketNotConnectedError, SocketAlreadyConnectedError } from '..'

async function example () {
  const auth = new Authflow('example')
  const client = new XboxClient(auth, { titleId: '123', scid: 'example', templateName: 'Lobby' })
  const session = await client.createSession({ name: 'example', properties: ({ profile }) => ({ custom: { owner: profile.xuid } }) })
  await session.setActivity()
  session.on('memberJoin', member => console.log(member.constants?.system?.xuid))
  session.on('propertiesChanged', properties => console.log(properties.custom))
  session.on('changed', (current, previous) => console.log(current.members, previous.members))
  console.log(session.current.properties)
  await session.invite({ gamertag: '12345' })
  await session.updateProperties({ custom: { game: 'example' } })
  await session.get({ signal: new AbortController().signal })
  await session.close()
  await client.joinSession('existing')
  await client.getActivityHandles('123')
  // @ts-expect-error Strings cannot ambiguously identify gamertags or XUIDs.
  await client.getProfile('12345')
  // @ts-expect-error A user identifier must choose one interpretation.
  await client.getProfile({ xuid: '123', gamertag: '123' })
  // @ts-expect-error Sessions are returned by factories, not constructed directly.
  new XboxSession()
  const rta = new XboxRTASocket(auth)
  await rta.connect().catch(error => {
    if (error instanceof SocketError) console.log(error.name)
    if (error instanceof SocketClosedError || error instanceof SocketNotConnectedError || error instanceof SocketAlreadyConnectedError) console.log(error.message)
  })
  const sub = await rta.subscribe<{ ConnectionId: string }>('https://sessiondirectory.xboxlive.com/connections/')
  sub.on('ready', data => console.log(data.ConnectionId))
  await sub.close()
  await rta.close()
  const playfab = new PlayFabClient(() => ({ SessionTicket: 'ticket' }), { titleId: 'ABC' })
  await playfab.getTitleData({ keys: ['ServerList'] })
  await playfab.getUserInventory()
  await playfab.executeCloudScript({ functionName: 'Run', functionParameter: {} })
  await playfab.request('Client/GetAccountInfo').catch(error => {
    if (error instanceof ServiceError) console.log(error.code, error.status)
  })
}
void example
