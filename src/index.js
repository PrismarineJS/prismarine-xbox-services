module.exports = {
  ServiceError: require('./errors').ServiceError,
  XboxClient: require('./xbox/client').XboxClient,
  XboxSession: require('./xbox/session').XboxSession,
  RtaSubscription: require('./rta/subscription').RtaSubscription,
  XboxRTA: require('./rta').XboxRTA,
  PlayFabClient: require('./playfab/client').PlayFabClient
}
