"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const disconnect_status_codes_1 = require("../disconnect_status_codes");
const errors_1 = require("../errors");
const p2p_request_1 = require("../p2p_request");
const utils_1 = require("../utils");
const validation_1 = require("../validation");
exports.EVENT_REQUEST_RECEIVED = 'requestReceived';
exports.EVENT_INVALID_REQUEST_RECEIVED = 'invalidRequestReceived';
exports.EVENT_MESSAGE_RECEIVED = 'messageReceived';
exports.EVENT_INVALID_MESSAGE_RECEIVED = 'invalidMessageReceived';
exports.EVENT_BAN_PEER = 'banPeer';
exports.EVENT_DISCOVERED_PEER = 'discoveredPeer';
exports.EVENT_UNBAN_PEER = 'unbanPeer';
exports.EVENT_UPDATED_PEER_INFO = 'updatedPeerInfo';
exports.EVENT_FAILED_PEER_INFO_UPDATE = 'failedPeerInfoUpdate';
exports.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT = 'failedToCollectPeerDetailsOnConnect';
exports.EVENT_FAILED_TO_FETCH_PEERS = 'failedToFetchPeers';
exports.EVENT_FAILED_TO_FETCH_PEER_INFO = 'failedToFetchPeerInfo';
exports.EVENT_FAILED_TO_PUSH_NODE_INFO = 'failedToPushNodeInfo';
exports.REMOTE_EVENT_RPC_REQUEST = 'rpc-request';
exports.REMOTE_EVENT_MESSAGE = 'remote-message';
exports.REMOTE_RPC_UPDATE_PEER_INFO = 'updateMyself';
exports.REMOTE_RPC_GET_NODE_INFO = 'status';
exports.REMOTE_RPC_GET_PEERS_LIST = 'list';
exports.DEFAULT_CONNECT_TIMEOUT = 2000;
exports.DEFAULT_ACK_TIMEOUT = 2000;
exports.DEFAULT_REPUTATION_SCORE = 100;
exports.DEFAULT_PRODUCTIVITY_RESET_INTERVAL = 20000;
exports.DEFAULT_PRODUCTIVITY = {
    requestCounter: 0,
    responseCounter: 0,
    responseRate: 0,
    lastResponded: 0,
};
const RATE_NORMALIZATION_FACTOR = 1000;
var ConnectionState;
(function (ConnectionState) {
    ConnectionState["CONNECTING"] = "connecting";
    ConnectionState["OPEN"] = "open";
    ConnectionState["CLOSED"] = "closed";
})(ConnectionState = exports.ConnectionState || (exports.ConnectionState = {}));
exports.convertNodeInfoToLegacyFormat = (nodeInfo) => {
    const { httpPort, nonce, broadhash } = nodeInfo;
    return Object.assign({}, nodeInfo, { broadhash: broadhash ? broadhash : '', nonce: nonce ? nonce : '', httpPort: httpPort ? httpPort : 0 });
};
class Peer extends events_1.EventEmitter {
    constructor(peerInfo, peerConfig) {
        super();
        this._peerInfo = peerInfo;
        this._peerConfig = peerConfig;
        this._ipAddress = peerInfo.ipAddress;
        this._wsPort = peerInfo.wsPort;
        this._id = utils_1.constructPeerIdFromPeerInfo({
            ipAddress: this._ipAddress,
            wsPort: this._wsPort,
        });
        this._height = peerInfo.height ? peerInfo.height : 0;
        this._reputation = exports.DEFAULT_REPUTATION_SCORE;
        this._netgroup = utils_1.getNetgroup(this._ipAddress, peerConfig.secret);
        this._latency = 0;
        this._connectTime = Date.now();
        this._rpcCounter = new Map();
        this._rpcRates = new Map();
        this._messageCounter = new Map();
        this._messageRates = new Map();
        this._wsMessageCount = 0;
        this._wsMessageRate = 0;
        this._rateInterval = this._peerConfig.rateCalculationInterval;
        this._counterResetInterval = setInterval(() => {
            this._wsMessageRate =
                (this._wsMessageCount * RATE_NORMALIZATION_FACTOR) / this._rateInterval;
            this._wsMessageCount = 0;
            if (this._wsMessageRate > this._peerConfig.wsMaxMessageRate) {
                this.applyPenalty(this._peerConfig.wsMaxMessageRatePenalty);
                return;
            }
            this._rpcRates = new Map([...this._rpcCounter.entries()].map(([key, value]) => {
                const rate = value / this._rateInterval;
                return [key, rate];
            }));
            this._rpcCounter = new Map();
            this._messageRates = new Map([...this._messageCounter.entries()].map(([key, value]) => {
                const rate = value / this._rateInterval;
                return [key, rate];
            }));
            this._messageCounter = new Map();
        }, this._rateInterval);
        this._productivityResetInterval = setInterval(() => {
            if (this._productivity.lastResponded <
                Date.now() - exports.DEFAULT_PRODUCTIVITY_RESET_INTERVAL) {
                this._productivity = Object.assign({}, exports.DEFAULT_PRODUCTIVITY);
            }
        }, exports.DEFAULT_PRODUCTIVITY_RESET_INTERVAL);
        this._productivity = Object.assign({}, exports.DEFAULT_PRODUCTIVITY);
        this._handleRawRPC = (packet, respond) => {
            let rawRequest;
            try {
                rawRequest = validation_1.validateRPCRequest(packet);
            }
            catch (err) {
                respond(err);
                this.emit(exports.EVENT_INVALID_REQUEST_RECEIVED, {
                    packet,
                    peerId: this._id,
                });
                return;
            }
            this._updateRPCCounter(rawRequest);
            const rate = this._getRPCRate(rawRequest);
            const request = new p2p_request_1.P2PRequest({
                procedure: rawRequest.procedure,
                data: rawRequest.data,
                id: this._id,
                rate,
                productivity: this._productivity,
            }, respond);
            if (rawRequest.procedure === exports.REMOTE_RPC_UPDATE_PEER_INFO) {
                this._handleUpdatePeerInfo(request);
            }
            else if (rawRequest.procedure === exports.REMOTE_RPC_GET_NODE_INFO) {
                this._handleGetNodeInfo(request);
            }
            this.emit(exports.EVENT_REQUEST_RECEIVED, request);
        };
        this._handleWSMessage = () => {
            this._wsMessageCount += 1;
        };
        this._handleRawMessage = (packet) => {
            let message;
            try {
                message = validation_1.validateProtocolMessage(packet);
            }
            catch (err) {
                this.emit(exports.EVENT_INVALID_MESSAGE_RECEIVED, {
                    packet,
                    peerId: this._id,
                });
                return;
            }
            this._updateMessageCounter(message);
            const rate = this._getMessageRate(message);
            const messageWithRateInfo = Object.assign({}, message, { peerId: this._id, rate });
            this.emit(exports.EVENT_MESSAGE_RECEIVED, messageWithRateInfo);
        };
        this._handleRawLegacyMessagePostBlock = (data) => {
            this._handleRawMessage({
                event: 'postBlock',
                data,
            });
        };
        this._handleRawLegacyMessagePostTransactions = (data) => {
            this._handleRawMessage({
                event: 'postTransactions',
                data,
            });
        };
        this._handleRawLegacyMessagePostSignatures = (data) => {
            this._handleRawMessage({
                event: 'postSignatures',
                data,
            });
        };
    }
    get height() {
        return this._height;
    }
    get id() {
        return this._id;
    }
    get ipAddress() {
        return this._ipAddress;
    }
    get reputation() {
        return this._reputation;
    }
    get netgroup() {
        return this._netgroup;
    }
    get latency() {
        return this._latency;
    }
    get connectTime() {
        return this._connectTime;
    }
    get responseRate() {
        return this._productivity.responseRate;
    }
    get productivity() {
        return Object.assign({}, this._productivity);
    }
    get wsMessageRate() {
        return this._wsMessageRate;
    }
    updatePeerInfo(newPeerInfo) {
        this._peerInfo = Object.assign({}, newPeerInfo, { ipAddress: this._ipAddress, wsPort: this._wsPort });
    }
    get peerInfo() {
        return this._peerInfo;
    }
    applyPenalty(penalty) {
        this._reputation -= penalty;
        if (this._reputation <= 0) {
            this._banPeer();
        }
    }
    get wsPort() {
        return this._wsPort;
    }
    get state() {
        const state = this._socket
            ? this._socket.state === this._socket.OPEN
                ? ConnectionState.OPEN
                : ConnectionState.CLOSED
            : ConnectionState.CLOSED;
        return state;
    }
    async applyNodeInfo(nodeInfo) {
        this._nodeInfo = nodeInfo;
        const legacyNodeInfo = exports.convertNodeInfoToLegacyFormat(this._nodeInfo);
        await this.request({
            procedure: exports.REMOTE_RPC_UPDATE_PEER_INFO,
            data: legacyNodeInfo,
        });
    }
    get nodeInfo() {
        return this._nodeInfo;
    }
    connect() {
        if (!this._socket) {
            throw new Error('Peer socket does not exist');
        }
    }
    disconnect(code = 1000, reason) {
        clearInterval(this._counterResetInterval);
        clearInterval(this._productivityResetInterval);
        if (this._socket) {
            this._socket.destroy(code, reason);
        }
    }
    send(packet) {
        if (!this._socket) {
            throw new Error('Peer socket does not exist');
        }
        const legacyEvents = ['postBlock', 'postTransactions', 'postSignatures'];
        if (legacyEvents.includes(packet.event)) {
            this._socket.emit(packet.event, packet.data);
        }
        else {
            this._socket.emit(exports.REMOTE_EVENT_MESSAGE, {
                event: packet.event,
                data: packet.data,
            });
        }
    }
    async request(packet) {
        return new Promise((resolve, reject) => {
            if (!this._socket) {
                throw new Error('Peer socket does not exist');
            }
            this._socket.emit(exports.REMOTE_EVENT_RPC_REQUEST, {
                type: '/RPCRequest',
                procedure: packet.procedure,
                data: packet.data,
            }, (err, responseData) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (responseData) {
                    resolve(responseData);
                    return;
                }
                reject(new errors_1.RPCResponseError(`Failed to handle response for procedure ${packet.procedure}`, `${this.ipAddress}:${this.wsPort}`));
            });
        });
    }
    async fetchPeers() {
        try {
            const response = await this.request({
                procedure: exports.REMOTE_RPC_GET_PEERS_LIST,
            });
            return validation_1.validatePeersInfoList(response.data, this._peerConfig.maxPeerDiscoveryResponseLength, this._peerConfig.maxPeerInfoSize);
        }
        catch (error) {
            this.emit(exports.EVENT_FAILED_TO_FETCH_PEERS, error);
            throw new errors_1.RPCResponseError('Failed to fetch peer list of peer', this.ipAddress);
        }
    }
    async discoverPeers() {
        const discoveredPeerInfoList = await this.fetchPeers();
        discoveredPeerInfoList.forEach(peerInfo => {
            this.emit(exports.EVENT_DISCOVERED_PEER, peerInfo);
        });
        return discoveredPeerInfoList;
    }
    async fetchStatus() {
        let response;
        try {
            response = await this.request({
                procedure: exports.REMOTE_RPC_GET_NODE_INFO,
            });
        }
        catch (error) {
            this.emit(exports.EVENT_FAILED_TO_FETCH_PEER_INFO, error);
            throw new errors_1.RPCResponseError('Failed to fetch peer info of peer', `${this.ipAddress}:${this.wsPort}`);
        }
        try {
            this._updateFromProtocolPeerInfo(response.data);
        }
        catch (error) {
            this.emit(exports.EVENT_FAILED_PEER_INFO_UPDATE, error);
            throw new errors_1.RPCResponseError('Failed to update peer info of peer as part of fetch operation', `${this.ipAddress}:${this.wsPort}`);
        }
        this.emit(exports.EVENT_UPDATED_PEER_INFO, this._peerInfo);
        return this._peerInfo;
    }
    _updateFromProtocolPeerInfo(rawPeerInfo) {
        const protocolPeerInfo = Object.assign({}, rawPeerInfo, { ip: this._ipAddress });
        const newPeerInfo = validation_1.validatePeerInfo(protocolPeerInfo, this._peerConfig.maxPeerInfoSize);
        this.updatePeerInfo(newPeerInfo);
    }
    _handleUpdatePeerInfo(request) {
        try {
            this._updateFromProtocolPeerInfo(request.data);
        }
        catch (error) {
            this.emit(exports.EVENT_FAILED_PEER_INFO_UPDATE, error);
            request.error(error);
            return;
        }
        request.end();
        this.emit(exports.EVENT_UPDATED_PEER_INFO, this._peerInfo);
    }
    _handleGetNodeInfo(request) {
        const legacyNodeInfo = this._nodeInfo
            ? exports.convertNodeInfoToLegacyFormat(this._nodeInfo)
            : {};
        request.end(legacyNodeInfo);
    }
    _banPeer() {
        this.emit(exports.EVENT_BAN_PEER, this._id);
        this.disconnect(disconnect_status_codes_1.FORBIDDEN_CONNECTION, disconnect_status_codes_1.FORBIDDEN_CONNECTION_REASON);
    }
    _updateRPCCounter(packet) {
        const key = packet.procedure;
        const count = (this._rpcCounter.get(key) || 0) + 1;
        this._rpcCounter.set(key, count);
    }
    _getRPCRate(packet) {
        const rate = this._rpcRates.get(packet.procedure) || 0;
        return rate * RATE_NORMALIZATION_FACTOR;
    }
    _updateMessageCounter(packet) {
        const key = packet.event;
        const count = (this._messageCounter.get(key) || 0) + 1;
        this._messageCounter.set(key, count);
    }
    _getMessageRate(packet) {
        const rate = this._messageRates.get(packet.event) || 0;
        return rate * RATE_NORMALIZATION_FACTOR;
    }
}
exports.Peer = Peer;
//# sourceMappingURL=base.js.map