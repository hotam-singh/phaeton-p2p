"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const phaeton_cryptography_1 = require("@phaetonhq/phaeton-cryptography");
const events_1 = require("events");
const http = require("http");
const shuffle = require("lodash.shuffle");
const socketcluster_server_1 = require("socketcluster-server");
const url = require("url");
const peer_1 = require("./peer");
const peer_directory_1 = require("./peer_directory");
const disconnect_status_codes_1 = require("./disconnect_status_codes");
const errors_1 = require("./errors");
const p2p_request_1 = require("./p2p_request");
exports.P2PRequest = p2p_request_1.P2PRequest;
const peer_selection_1 = require("./peer_selection");
const peer_pool_1 = require("./peer_pool");
exports.EVENT_BAN_PEER = peer_pool_1.EVENT_BAN_PEER;
exports.EVENT_CLOSE_INBOUND = peer_pool_1.EVENT_CLOSE_INBOUND;
exports.EVENT_CLOSE_OUTBOUND = peer_pool_1.EVENT_CLOSE_OUTBOUND;
exports.EVENT_CONNECT_ABORT_OUTBOUND = peer_pool_1.EVENT_CONNECT_ABORT_OUTBOUND;
exports.EVENT_CONNECT_OUTBOUND = peer_pool_1.EVENT_CONNECT_OUTBOUND;
exports.EVENT_DISCOVERED_PEER = peer_pool_1.EVENT_DISCOVERED_PEER;
exports.EVENT_FAILED_PEER_INFO_UPDATE = peer_pool_1.EVENT_FAILED_PEER_INFO_UPDATE;
exports.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT = peer_pool_1.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT;
exports.EVENT_FAILED_TO_FETCH_PEER_INFO = peer_pool_1.EVENT_FAILED_TO_FETCH_PEER_INFO;
exports.EVENT_FAILED_TO_PUSH_NODE_INFO = peer_pool_1.EVENT_FAILED_TO_PUSH_NODE_INFO;
exports.EVENT_FAILED_TO_SEND_MESSAGE = peer_pool_1.EVENT_FAILED_TO_SEND_MESSAGE;
exports.EVENT_INBOUND_SOCKET_ERROR = peer_pool_1.EVENT_INBOUND_SOCKET_ERROR;
exports.EVENT_MESSAGE_RECEIVED = peer_pool_1.EVENT_MESSAGE_RECEIVED;
exports.EVENT_OUTBOUND_SOCKET_ERROR = peer_pool_1.EVENT_OUTBOUND_SOCKET_ERROR;
exports.EVENT_REMOVE_PEER = peer_pool_1.EVENT_REMOVE_PEER;
exports.EVENT_REQUEST_RECEIVED = peer_pool_1.EVENT_REQUEST_RECEIVED;
exports.EVENT_UNBAN_PEER = peer_pool_1.EVENT_UNBAN_PEER;
exports.EVENT_UPDATED_PEER_INFO = peer_pool_1.EVENT_UPDATED_PEER_INFO;
const utils_1 = require("./utils");
const validation_1 = require("./validation");
exports.EVENT_NEW_INBOUND_PEER = 'newInboundPeer';
exports.EVENT_FAILED_TO_ADD_INBOUND_PEER = 'failedToAddInboundPeer';
exports.EVENT_NEW_PEER = 'newPeer';
exports.EVENT_NETWORK_READY = 'networkReady';
exports.DEFAULT_NODE_HOST_IP = '0.0.0.0';
exports.DEFAULT_DISCOVERY_INTERVAL = 30000;
exports.DEFAULT_BAN_TIME = 86400;
exports.DEFAULT_POPULATOR_INTERVAL = 10000;
exports.DEFAULT_SEND_PEER_LIMIT = 24;
exports.DEFAULT_WS_MAX_MESSAGE_RATE = 100;
exports.DEFAULT_WS_MAX_MESSAGE_RATE_PENALTY = 100;
exports.DEFAULT_RATE_CALCULATION_INTERVAL = 1000;
exports.DEFAULT_WS_MAX_PAYLOAD = 3048576;
const BASE_10_RADIX = 10;
exports.DEFAULT_MAX_OUTBOUND_CONNECTIONS = 20;
exports.DEFAULT_MAX_INBOUND_CONNECTIONS = 100;
exports.DEFAULT_OUTBOUND_SHUFFLE_INTERVAL = 300000;
exports.DEFAULT_PEER_PROTECTION_FOR_NETGROUP = 0.034;
exports.DEFAULT_PEER_PROTECTION_FOR_LATENCY = 0.068;
exports.DEFAULT_PEER_PROTECTION_FOR_USEFULNESS = 0.068;
exports.DEFAULT_PEER_PROTECTION_FOR_LONGEVITY = 0.5;
exports.DEFAULT_MIN_PEER_DISCOVERY_THRESHOLD = 100;
exports.DEFAULT_MAX_PEER_DISCOVERY_RESPONSE_LENGTH = 1000;
exports.DEFAULT_MAX_PEER_INFO_SIZE = 20480;
const SECRET_BYTE_LENGTH = 4;
exports.DEFAULT_RANDOM_SECRET = phaeton_cryptography_1.getRandomBytes(SECRET_BYTE_LENGTH).readUInt32BE(0);
const selectRandomPeerSample = (peerList, count) => shuffle(peerList).slice(0, count);
class P2P extends events_1.EventEmitter {
    constructor(config) {
        super();
        this._sanitizedPeerLists = validation_1.sanitizePeerLists({
            seedPeers: config.seedPeers || [],
            blacklistedPeers: config.blacklistedPeers || [],
            fixedPeers: config.fixedPeers || [],
            whitelisted: config.whitelistedPeers || [],
            previousPeers: config.previousPeers || [],
        }, {
            ipAddress: config.hostIp || exports.DEFAULT_NODE_HOST_IP,
            wsPort: config.nodeInfo.wsPort,
        });
        this._config = config;
        this._isActive = false;
        this._hasConnected = false;
        this._peerBook = new peer_directory_1.PeerBook({
            secret: config.secret ? config.secret : exports.DEFAULT_RANDOM_SECRET,
        });
        this._bannedPeers = new Set();
        this._httpServer = http.createServer();
        this._scServer = socketcluster_server_1.attach(this._httpServer, {
            wsEngineServerOptions: {
                maxPayload: config.wsMaxPayload
                    ? config.wsMaxPayload
                    : exports.DEFAULT_WS_MAX_PAYLOAD,
            },
        });
        this._handlePeerPoolRPC = (request) => {
            if (request.procedure === peer_1.REMOTE_RPC_GET_PEERS_LIST) {
                this._handleGetPeersRequest(request);
            }
            this.emit(peer_pool_1.EVENT_REQUEST_RECEIVED, request);
        };
        this._handlePeerPoolMessage = (message) => {
            this.emit(peer_pool_1.EVENT_MESSAGE_RECEIVED, message);
        };
        this._handleOutboundPeerConnect = (peerInfo) => {
            const foundTriedPeer = this._peerBook.getPeer(peerInfo);
            if (foundTriedPeer) {
                const updatedPeerInfo = Object.assign({}, peerInfo, { ipAddress: foundTriedPeer.ipAddress, wsPort: foundTriedPeer.wsPort });
                this._peerBook.upgradePeer(updatedPeerInfo);
            }
            else {
                this._peerBook.addPeer(peerInfo);
                this._peerBook.upgradePeer(peerInfo);
            }
            this.emit(peer_pool_1.EVENT_CONNECT_OUTBOUND, peerInfo);
            if (this._isNetworkReady()) {
                this.emit(exports.EVENT_NETWORK_READY);
            }
        };
        this._handleOutboundPeerConnectAbort = (peerInfo) => {
            const peerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
            const isWhitelisted = this._sanitizedPeerLists.whitelisted.find(peer => utils_1.constructPeerIdFromPeerInfo(peer) === peerId);
            if (this._peerBook.getPeer(peerInfo) && !isWhitelisted) {
                this._peerBook.downgradePeer(peerInfo);
            }
            this.emit(peer_pool_1.EVENT_CONNECT_ABORT_OUTBOUND, peerInfo);
        };
        this._handlePeerCloseOutbound = (closePacket) => {
            this.emit(peer_pool_1.EVENT_CLOSE_OUTBOUND, closePacket);
        };
        this._handlePeerCloseInbound = (closePacket) => {
            this.emit(peer_pool_1.EVENT_CLOSE_INBOUND, closePacket);
        };
        this._handleRemovePeer = (peerId) => {
            this.emit(peer_pool_1.EVENT_REMOVE_PEER, peerId);
        };
        this._handlePeerInfoUpdate = (peerInfo) => {
            const foundPeer = this._peerBook.getPeer(peerInfo);
            if (foundPeer) {
                const updatedPeerInfo = Object.assign({}, peerInfo, { ipAddress: foundPeer.ipAddress, wsPort: foundPeer.wsPort });
                const isUpdated = this._peerBook.updatePeer(updatedPeerInfo);
                if (isUpdated) {
                    this._peerBook.upgradePeer(updatedPeerInfo);
                }
            }
            else {
                this._peerBook.addPeer(peerInfo);
                this._peerBook.upgradePeer(peerInfo);
            }
            this.emit(peer_pool_1.EVENT_UPDATED_PEER_INFO, peerInfo);
        };
        this._handleFailedPeerInfoUpdate = (error) => {
            this.emit(peer_pool_1.EVENT_FAILED_PEER_INFO_UPDATE, error);
        };
        this._handleFailedToFetchPeerInfo = (error) => {
            this.emit(peer_pool_1.EVENT_FAILED_TO_FETCH_PEER_INFO, error);
        };
        this._handleFailedToFetchPeers = (error) => {
            this.emit(peer_pool_1.EVENT_FAILED_TO_FETCH_PEERS, error);
        };
        this._handleFailedToCollectPeerDetails = (error) => {
            this.emit(peer_pool_1.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT, error);
        };
        this._handleBanPeer = (peerId) => {
            this._bannedPeers.add(peerId.split(':')[0]);
            const isWhitelisted = this._sanitizedPeerLists.whitelisted.find(peer => utils_1.constructPeerIdFromPeerInfo(peer) === peerId);
            const bannedPeerInfo = {
                ipAddress: peerId.split(':')[0],
                wsPort: +peerId.split(':')[1],
            };
            if (this._peerBook.getPeer(bannedPeerInfo) && !isWhitelisted) {
                this._peerBook.removePeer(bannedPeerInfo);
            }
            this.emit(peer_pool_1.EVENT_BAN_PEER, peerId);
        };
        this._handleUnbanPeer = (peerId) => {
            this._bannedPeers.delete(peerId.split(':')[0]);
            this.emit(peer_pool_1.EVENT_UNBAN_PEER, peerId);
        };
        this._handleDiscoveredPeer = (detailedPeerInfo) => {
            const peerId = utils_1.constructPeerIdFromPeerInfo(detailedPeerInfo);
            const isBlacklisted = this._sanitizedPeerLists.blacklistedPeers.find(peer => utils_1.constructPeerIdFromPeerInfo(peer) === peerId);
            if (!this._peerBook.getPeer(detailedPeerInfo) && !isBlacklisted) {
                const foundPeer = this._peerBook.getPeer(detailedPeerInfo);
                if (foundPeer) {
                    const updatedPeerInfo = Object.assign({}, detailedPeerInfo, { ipAddress: foundPeer.ipAddress, wsPort: foundPeer.wsPort });
                    const isUpdated = this._peerBook.updatePeer(updatedPeerInfo);
                    if (isUpdated) {
                        this._peerBook.upgradePeer(updatedPeerInfo);
                    }
                }
                else {
                    this._peerBook.addPeer(detailedPeerInfo);
                    this.emit(peer_pool_1.EVENT_DISCOVERED_PEER, detailedPeerInfo);
                }
            }
        };
        this._handleFailedToPushNodeInfo = (error) => {
            this.emit(peer_pool_1.EVENT_FAILED_TO_PUSH_NODE_INFO, error);
        };
        this._handleFailedToSendMessage = (error) => {
            this.emit(peer_pool_1.EVENT_FAILED_TO_SEND_MESSAGE, error);
        };
        this._handleOutboundSocketError = (error) => {
            this.emit(peer_pool_1.EVENT_OUTBOUND_SOCKET_ERROR, error);
        };
        this._handleInboundSocketError = (error) => {
            this.emit(peer_pool_1.EVENT_INBOUND_SOCKET_ERROR, error);
        };
        this._peerPool = new peer_pool_1.PeerPool({
            connectTimeout: config.connectTimeout,
            ackTimeout: config.ackTimeout,
            wsMaxPayload: config.wsMaxPayload
                ? config.wsMaxPayload
                : exports.DEFAULT_WS_MAX_PAYLOAD,
            peerSelectionForSend: config.peerSelectionForSend
                ? config.peerSelectionForSend
                : peer_selection_1.selectPeersForSend,
            peerSelectionForRequest: config.peerSelectionForRequest
                ? config.peerSelectionForRequest
                : peer_selection_1.selectPeersForRequest,
            peerSelectionForConnection: config.peerSelectionForConnection
                ? config.peerSelectionForConnection
                : peer_selection_1.selectPeersForConnection,
            sendPeerLimit: config.sendPeerLimit === undefined
                ? exports.DEFAULT_SEND_PEER_LIMIT
                : config.sendPeerLimit,
            peerBanTime: config.peerBanTime ? config.peerBanTime : exports.DEFAULT_BAN_TIME,
            maxOutboundConnections: config.maxOutboundConnections === undefined
                ? exports.DEFAULT_MAX_OUTBOUND_CONNECTIONS
                : config.maxOutboundConnections,
            maxInboundConnections: config.maxInboundConnections === undefined
                ? exports.DEFAULT_MAX_INBOUND_CONNECTIONS
                : config.maxInboundConnections,
            maxPeerDiscoveryResponseLength: config.maxPeerDiscoveryResponseLength === undefined
                ? exports.DEFAULT_MAX_PEER_DISCOVERY_RESPONSE_LENGTH
                : config.maxPeerDiscoveryResponseLength,
            maxPeerInfoSize: config.maxPeerInfoSize
                ? config.maxPeerInfoSize
                : exports.DEFAULT_MAX_PEER_INFO_SIZE,
            outboundShuffleInterval: config.outboundShuffleInterval
                ? config.outboundShuffleInterval
                : exports.DEFAULT_OUTBOUND_SHUFFLE_INTERVAL,
            netgroupProtectionRatio: typeof config.netgroupProtectionRatio === 'number'
                ? config.netgroupProtectionRatio
                : exports.DEFAULT_PEER_PROTECTION_FOR_NETGROUP,
            latencyProtectionRatio: typeof config.latencyProtectionRatio === 'number'
                ? config.latencyProtectionRatio
                : exports.DEFAULT_PEER_PROTECTION_FOR_LATENCY,
            productivityProtectionRatio: typeof config.productivityProtectionRatio === 'number'
                ? config.productivityProtectionRatio
                : exports.DEFAULT_PEER_PROTECTION_FOR_USEFULNESS,
            longevityProtectionRatio: typeof config.longevityProtectionRatio === 'number'
                ? config.longevityProtectionRatio
                : exports.DEFAULT_PEER_PROTECTION_FOR_LONGEVITY,
            wsMaxMessageRate: typeof config.wsMaxMessageRate === 'number'
                ? config.wsMaxMessageRate
                : exports.DEFAULT_WS_MAX_MESSAGE_RATE,
            wsMaxMessageRatePenalty: typeof config.wsMaxMessageRatePenalty === 'number'
                ? config.wsMaxMessageRatePenalty
                : exports.DEFAULT_WS_MAX_MESSAGE_RATE_PENALTY,
            rateCalculationInterval: typeof config.rateCalculationInterval === 'number'
                ? config.rateCalculationInterval
                : exports.DEFAULT_RATE_CALCULATION_INTERVAL,
            secret: config.secret ? config.secret : exports.DEFAULT_RANDOM_SECRET,
            peerLists: this._sanitizedPeerLists,
        });
        this._bindHandlersToPeerPool(this._peerPool);
        if (this._sanitizedPeerLists.previousPeers) {
            this._sanitizedPeerLists.previousPeers.forEach(peerInfo => {
                if (!this._peerBook.getPeer(peerInfo)) {
                    this._peerBook.addPeer(peerInfo);
                    this._peerBook.upgradePeer(peerInfo);
                }
                else {
                    this._peerBook.upgradePeer(peerInfo);
                }
            });
        }
        this._nodeInfo = config.nodeInfo;
        this.applyNodeInfo(this._nodeInfo);
        this._populatorInterval = config.populatorInterval
            ? config.populatorInterval
            : exports.DEFAULT_POPULATOR_INTERVAL;
        this._peerHandshakeCheck = config.peerHandshakeCheck
            ? config.peerHandshakeCheck
            : validation_1.checkPeerCompatibility;
    }
    get config() {
        return this._config;
    }
    get isActive() {
        return this._isActive;
    }
    applyNodeInfo(nodeInfo) {
        this._nodeInfo = Object.assign({}, nodeInfo);
        this._peerPool.applyNodeInfo(this._nodeInfo);
    }
    get nodeInfo() {
        return this._nodeInfo;
    }
    applyPenalty(peerPenalty) {
        if (!this._isTrustedPeer(peerPenalty.peerId)) {
            this._peerPool.applyPenalty(peerPenalty);
        }
    }
    getConnectedPeers() {
        return this._peerPool.getAllConnectedPeerInfos();
    }
    getUniqueOutboundConnectedPeers() {
        return this._peerPool.getUniqueOutboundConnectedPeers();
    }
    getDisconnectedPeers() {
        const allPeers = this._peerBook.getAllPeers();
        const connectedPeers = this.getConnectedPeers();
        const disconnectedPeers = allPeers.filter(peer => {
            if (connectedPeers.find(connectedPeer => peer.ipAddress === connectedPeer.ipAddress &&
                peer.wsPort === connectedPeer.wsPort)) {
                return false;
            }
            return true;
        });
        return disconnectedPeers;
    }
    async request(packet) {
        const response = await this._peerPool.request(packet);
        return response;
    }
    send(message) {
        this._peerPool.send(message);
    }
    async requestFromPeer(packet, peerId) {
        return this._peerPool.requestFromPeer(packet, peerId);
    }
    sendToPeer(message, peerId) {
        this._peerPool.sendToPeer(message, peerId);
    }
    _disconnectSocketDueToFailedHandshake(socket, statusCode, closeReason) {
        socket.disconnect(statusCode, closeReason);
        this.emit(exports.EVENT_FAILED_TO_ADD_INBOUND_PEER, new errors_1.PeerInboundHandshakeError(closeReason, statusCode, socket.remoteAddress, socket.request.url));
    }
    async _startPeerServer() {
        this._scServer.on('connection', (socket) => {
            if (this._sanitizedPeerLists.blacklistedPeers) {
                const blacklist = this._sanitizedPeerLists.blacklistedPeers.map(peer => peer.ipAddress);
                if (blacklist.includes(socket.remoteAddress)) {
                    this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.FORBIDDEN_CONNECTION, disconnect_status_codes_1.FORBIDDEN_CONNECTION_REASON);
                    return;
                }
            }
            if (!socket.request.url) {
                this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.INVALID_CONNECTION_URL_CODE, disconnect_status_codes_1.INVALID_CONNECTION_URL_REASON);
                return;
            }
            const queryObject = url.parse(socket.request.url, true).query;
            if (queryObject.nonce === this._nodeInfo.nonce) {
                this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.INVALID_CONNECTION_SELF_CODE, disconnect_status_codes_1.INVALID_CONNECTION_SELF_REASON);
                const selfWSPort = queryObject.wsPort
                    ? +queryObject.wsPort
                    : this._nodeInfo.wsPort;
                this._peerBook.removePeer({
                    ipAddress: socket.remoteAddress,
                    wsPort: selfWSPort,
                });
                return;
            }
            if (typeof queryObject.wsPort !== 'string' ||
                typeof queryObject.version !== 'string' ||
                typeof queryObject.nethash !== 'string') {
                this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.INVALID_CONNECTION_QUERY_CODE, disconnect_status_codes_1.INVALID_CONNECTION_QUERY_REASON);
                return;
            }
            const wsPort = parseInt(queryObject.wsPort, BASE_10_RADIX);
            const peerId = utils_1.constructPeerIdFromPeerInfo({
                ipAddress: socket.remoteAddress,
                wsPort,
            });
            let queryOptions;
            try {
                queryOptions =
                    typeof queryObject.options === 'string'
                        ? JSON.parse(queryObject.options)
                        : undefined;
            }
            catch (error) {
                this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.INVALID_CONNECTION_QUERY_CODE, disconnect_status_codes_1.INVALID_CONNECTION_QUERY_REASON);
                return;
            }
            if (this._bannedPeers.has(socket.remoteAddress)) {
                this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.FORBIDDEN_CONNECTION, disconnect_status_codes_1.FORBIDDEN_CONNECTION_REASON);
                return;
            }
            const incomingPeerInfo = Object.assign({}, queryObject, queryOptions, { ipAddress: socket.remoteAddress, wsPort, height: queryObject.height ? +queryObject.height : 0, version: queryObject.version });
            const { success, errors } = this._peerHandshakeCheck(incomingPeerInfo, this._nodeInfo);
            if (!success) {
                const incompatibilityReason = errors && Array.isArray(errors)
                    ? errors.join(',')
                    : disconnect_status_codes_1.INCOMPATIBLE_PEER_UNKNOWN_REASON;
                this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.INCOMPATIBLE_PEER_CODE, incompatibilityReason);
                return;
            }
            const existingPeer = this._peerPool.getPeer(peerId);
            if (existingPeer) {
                this._disconnectSocketDueToFailedHandshake(socket, disconnect_status_codes_1.DUPLICATE_CONNECTION, disconnect_status_codes_1.DUPLICATE_CONNECTION_REASON);
            }
            else {
                this._peerPool.addInboundPeer(incomingPeerInfo, socket);
                this.emit(exports.EVENT_NEW_INBOUND_PEER, incomingPeerInfo);
                this.emit(exports.EVENT_NEW_PEER, incomingPeerInfo);
            }
            if (!this._peerBook.getPeer(incomingPeerInfo)) {
                this._peerBook.addPeer(incomingPeerInfo);
            }
        });
        this._httpServer.listen(this._nodeInfo.wsPort, this._config.hostIp || exports.DEFAULT_NODE_HOST_IP);
        if (this._scServer.isReady) {
            this._isActive = true;
            return;
        }
        return new Promise(resolve => {
            this._scServer.once('ready', () => {
                this._isActive = true;
                resolve();
            });
        });
    }
    async _stopHTTPServer() {
        return new Promise(resolve => {
            this._httpServer.close(() => {
                resolve();
            });
        });
    }
    async _stopWSServer() {
        return new Promise(resolve => {
            this._scServer.close(() => {
                resolve();
            });
        });
    }
    async _stopPeerServer() {
        await this._stopWSServer();
        await this._stopHTTPServer();
    }
    _startPopulator() {
        if (this._populatorIntervalId) {
            throw new Error('Populator is already running');
        }
        this._populatorIntervalId = setInterval(() => {
            this._peerPool.triggerNewConnections(this._peerBook.newPeers, this._peerBook.triedPeers, this._sanitizedPeerLists.fixedPeers || []);
        }, this._populatorInterval);
        this._peerPool.triggerNewConnections(this._peerBook.newPeers, this._peerBook.triedPeers, this._sanitizedPeerLists.fixedPeers || []);
    }
    _stopPopulator() {
        if (this._populatorIntervalId) {
            clearInterval(this._populatorIntervalId);
        }
    }
    _isNetworkReady() {
        if (!this._hasConnected && this._peerPool.getConnectedPeers().length > 0) {
            this._hasConnected = true;
            return true;
        }
        return false;
    }
    _pickRandomPeers(count) {
        const peerList = this._peerBook.getAllPeers();
        return selectRandomPeerSample(peerList, count);
    }
    _handleGetPeersRequest(request) {
        const minimumPeerDiscoveryThreshold = this._config
            .minimumPeerDiscoveryThreshold
            ? this._config.minimumPeerDiscoveryThreshold
            : exports.DEFAULT_MIN_PEER_DISCOVERY_THRESHOLD;
        const peerDiscoveryResponseLength = this._config.peerDiscoveryResponseLength
            ? this._config.peerDiscoveryResponseLength
            : exports.DEFAULT_MAX_PEER_DISCOVERY_RESPONSE_LENGTH;
        const knownPeers = this._peerBook.getAllPeers();
        const min = Math.ceil(Math.min(peerDiscoveryResponseLength, knownPeers.length * 0.25));
        const max = Math.floor(Math.min(peerDiscoveryResponseLength, knownPeers.length * 0.5));
        const random = Math.floor(Math.random() * (max - min + 1) + min);
        const randomPeerCount = Math.max(random, Math.min(minimumPeerDiscoveryThreshold, knownPeers.length));
        const selectedPeers = this._pickRandomPeers(randomPeerCount).map(validation_1.outgoingPeerInfoSanitization);
        const peerInfoList = {
            success: true,
            peers: selectedPeers,
        };
        request.end(peerInfoList);
    }
    _isTrustedPeer(peerId) {
        const isSeed = this._sanitizedPeerLists.seedPeers.find(seedPeer => peerId ===
            utils_1.constructPeerIdFromPeerInfo({
                ipAddress: seedPeer.ipAddress,
                wsPort: seedPeer.wsPort,
            }));
        const isWhitelisted = this._sanitizedPeerLists.whitelisted.find(peer => utils_1.constructPeerIdFromPeerInfo(peer) === peerId);
        const isFixed = this._sanitizedPeerLists.fixedPeers.find(peer => utils_1.constructPeerIdFromPeerInfo(peer) === peerId);
        return !!isSeed || !!isWhitelisted || !!isFixed;
    }
    async start() {
        if (this._isActive) {
            throw new Error('Cannot start the node because it is already active');
        }
        const newPeersToAdd = this._sanitizedPeerLists.seedPeers.concat(this._sanitizedPeerLists.whitelisted);
        newPeersToAdd.forEach(newPeerInfo => {
            if (!this._peerBook.getPeer(newPeerInfo)) {
                this._peerBook.addPeer(newPeerInfo);
            }
        });
        this._sanitizedPeerLists.whitelisted.forEach(whitelistPeer => this._peerBook.upgradePeer(whitelistPeer));
        await this._startPeerServer();
        if (this._isActive) {
            this._startPopulator();
        }
    }
    async stop() {
        if (!this._isActive) {
            throw new Error('Cannot stop the node because it is not active');
        }
        this._isActive = false;
        this._hasConnected = false;
        this._stopPopulator();
        this._peerPool.removeAllPeers();
        await this._stopPeerServer();
    }
    _bindHandlersToPeerPool(peerPool) {
        peerPool.on(peer_pool_1.EVENT_REQUEST_RECEIVED, this._handlePeerPoolRPC);
        peerPool.on(peer_pool_1.EVENT_MESSAGE_RECEIVED, this._handlePeerPoolMessage);
        peerPool.on(peer_pool_1.EVENT_CONNECT_OUTBOUND, this._handleOutboundPeerConnect);
        peerPool.on(peer_pool_1.EVENT_CONNECT_ABORT_OUTBOUND, this._handleOutboundPeerConnectAbort);
        peerPool.on(peer_pool_1.EVENT_CLOSE_INBOUND, this._handlePeerCloseInbound);
        peerPool.on(peer_pool_1.EVENT_CLOSE_OUTBOUND, this._handlePeerCloseOutbound);
        peerPool.on(peer_pool_1.EVENT_REMOVE_PEER, this._handleRemovePeer);
        peerPool.on(peer_pool_1.EVENT_UPDATED_PEER_INFO, this._handlePeerInfoUpdate);
        peerPool.on(peer_pool_1.EVENT_FAILED_PEER_INFO_UPDATE, this._handleFailedPeerInfoUpdate);
        peerPool.on(peer_pool_1.EVENT_FAILED_TO_FETCH_PEER_INFO, this._handleFailedToFetchPeerInfo);
        peerPool.on(peer_pool_1.EVENT_FAILED_TO_FETCH_PEERS, this._handleFailedToFetchPeers);
        peerPool.on(peer_pool_1.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT, this._handleFailedToCollectPeerDetails);
        peerPool.on(peer_pool_1.EVENT_DISCOVERED_PEER, this._handleDiscoveredPeer);
        peerPool.on(peer_pool_1.EVENT_FAILED_TO_PUSH_NODE_INFO, this._handleFailedToPushNodeInfo);
        peerPool.on(peer_pool_1.EVENT_FAILED_TO_SEND_MESSAGE, this._handleFailedToSendMessage);
        peerPool.on(peer_pool_1.EVENT_OUTBOUND_SOCKET_ERROR, this._handleOutboundSocketError);
        peerPool.on(peer_pool_1.EVENT_INBOUND_SOCKET_ERROR, this._handleInboundSocketError);
        peerPool.on(peer_pool_1.EVENT_BAN_PEER, this._handleBanPeer);
        peerPool.on(peer_pool_1.EVENT_UNBAN_PEER, this._handleUnbanPeer);
    }
}
exports.P2P = P2P;
//# sourceMappingURL=p2p.js.map
