const MessageType = { Subscribe: 1, Unsubscribe: 2, Event: 3, Resync: 4 }
const StatusCode = { Success: 0, UnknownResource: 1, SubscriptionLimitReached: 2, NoResourceData: 3, Throttled: 1001, ServiceUnavailable: 1002 }
const convertRTAStatus = status => Object.keys(StatusCode).find(key => StatusCode[key] === status) || 'Unknown'
module.exports = { MessageType, StatusCode, convertRTAStatus }
