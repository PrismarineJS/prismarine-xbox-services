module.exports = {
  createXboxClient: require('./xbox/client').createXboxClient,
  createPlayFabClient: require('./playfab/client').createPlayFabClient,
  connectRta: require('./rta').connectRta,
  ServiceError: require('./errors').ServiceError
}
