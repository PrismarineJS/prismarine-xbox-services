import { Authflow } from 'prismarine-auth'
import { createXboxClient, connectRta, createPlayFabClient, ServiceError } from '..'

async function example () {
  const auth = new Authflow('example')
  const client = createXboxClient(auth, { titleId: '123', scid: 'example', templateName: 'Lobby' })
  const session = await client.createSession({ properties: ({ profile }) => ({ custom: { owner: profile.xuid } }) })
  await session.invite({ gamertag: '12345' })
  await session.updateProperties({ custom: { game: 'example' } })
  await session.get({ signal: new AbortController().signal })
  session.on('memberJoin', member => console.log(member.constants?.system?.xuid))
  session.on('changed', document => console.log(document.properties))
  await session.setActivity()
  await session.close()
  await client.joinSession('existing')
  await client.getActivityHandles('123')
  // @ts-expect-error Strings cannot ambiguously identify gamertags or XUIDs.
  await client.getProfile('12345')
  // @ts-expect-error A user identifier must choose one interpretation.
  await client.getProfile({ xuid: '123', gamertag: '123' })
  const rta = await connectRta(auth)
  const sub = await rta.subscribe<{ ConnectionId: string }>('https://sessiondirectory.xboxlive.com/connections/')
  sub.on('ready', data => console.log(data.ConnectionId))
  await sub.close()
  await rta.close()
  const playfab = createPlayFabClient(() => ({ SessionTicket: 'ticket' }), { titleId: 'ABC' })
  await playfab.getTitleData({ keys: ['ServerList'] })
  await playfab.getUserInventory()
  await playfab.executeCloudScript({ functionName: 'Example', functionParameter: {} })
  await playfab.request('Client/GetAccountInfo').catch(error => {
    if (error instanceof ServiceError) console.log(error.code, error.status)
  })
}
void example
