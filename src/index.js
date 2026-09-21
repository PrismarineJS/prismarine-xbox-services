const { SocketError, SocketClosedError, SocketNotConnectedError, SocketAlreadyConnectedError } = require('./rta/constants')

module.exports = {
  SocketError,
  SocketClosedError,
  SocketNotConnectedError,
  SocketAlreadyConnectedError,
  ServiceError: require('./errors').ServiceError,
  XboxClient: require('./xbox/client').XboxClient,
  XboxSession: require('./xbox/session').XboxSession,
  RtaSubscription: require('./rta/subscription').RtaSubscription,
  XboxRTASocket: require('./rta').XboxRTASocket,
  PlayFabClient: require('./playfab/client').PlayFabClient
}
