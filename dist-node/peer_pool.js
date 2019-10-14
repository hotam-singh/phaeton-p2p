"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const shuffle = require("lodash.shuffle");
const errors_1 = require("./errors");
const peer_1 = require("./peer");
exports.EVENT_BAN_PEER = peer_1.EVENT_BAN_PEER;
exports.EVENT_CLOSE_INBOUND = peer_1.EVENT_CLOSE_INBOUND;
exports.EVENT_CLOSE_OUTBOUND = peer_1.EVENT_CLOSE_OUTBOUND;
exports.EVENT_CONNECT_ABORT_OUTBOUND = peer_1.EVENT_CONNECT_ABORT_OUTBOUND;
exports.EVENT_CONNECT_OUTBOUND = peer_1.EVENT_CONNECT_OUTBOUND;
exports.EVENT_DISCOVERED_PEER = peer_1.EVENT_DISCOVERED_PEER;
exports.EVENT_FAILED_PEER_INFO_UPDATE = peer_1.EVENT_FAILED_PEER_INFO_UPDATE;
exports.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT = peer_1.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT;
exports.EVENT_FAILED_TO_FETCH_PEER_INFO = peer_1.EVENT_FAILED_TO_FETCH_PEER_INFO;
exports.EVENT_FAILED_TO_FETCH_PEERS = peer_1.EVENT_FAILED_TO_FETCH_PEERS;
exports.EVENT_FAILED_TO_PUSH_NODE_INFO = peer_1.EVENT_FAILED_TO_PUSH_NODE_INFO;
exports.EVENT_INBOUND_SOCKET_ERROR = peer_1.EVENT_INBOUND_SOCKET_ERROR;
exports.EVENT_MESSAGE_RECEIVED = peer_1.EVENT_MESSAGE_RECEIVED;
exports.EVENT_OUTBOUND_SOCKET_ERROR = peer_1.EVENT_OUTBOUND_SOCKET_ERROR;
exports.EVENT_REQUEST_RECEIVED = peer_1.EVENT_REQUEST_RECEIVED;
exports.EVENT_UNBAN_PEER = peer_1.EVENT_UNBAN_PEER;
exports.EVENT_UPDATED_PEER_INFO = peer_1.EVENT_UPDATED_PEER_INFO;
const peer_selection_1 = require("./peer_selection");
const utils_1 = require("./utils");
const disconnect_status_codes_1 = require("./disconnect_status_codes");
exports.MAX_PEER_LIST_BATCH_SIZE = 100;
exports.MAX_PEER_DISCOVERY_PROBE_SAMPLE_SIZE = 100;
exports.EVENT_REMOVE_PEER = 'removePeer';
exports.INTENTIONAL_DISCONNECT_STATUS_CODE = 1000;
exports.EVENT_FAILED_TO_SEND_MESSAGE = 'failedToSendMessage';
exports.PEER_KIND_OUTBOUND = 'outbound';
exports.PEER_KIND_INBOUND = 'inbound';
var PROTECTION_CATEGORY;
(function (PROTECTION_CATEGORY) {
    PROTECTION_CATEGORY["NET_GROUP"] = "netgroup";
    PROTECTION_CATEGORY["LATENCY"] = "latency";
    PROTECTION_CATEGORY["RESPONSE_RATE"] = "responseRate";
    PROTECTION_CATEGORY["CONNECT_TIME"] = "connectTime";
})(PROTECTION_CATEGORY = exports.PROTECTION_CATEGORY || (exports.PROTECTION_CATEGORY = {}));
const filterPeersByCategory = (peers, options) => {
    if (options.percentage > 1 || options.percentage < 0) {
        return peers;
    }
    const peerCount = Math.ceil(peers.length * options.percentage);
    const sign = !!options.asc ? 1 : -1;
    return peers
        .sort((a, b) => a[options.category] > b[options.category] ? sign : sign * -1)
        .slice(peerCount, peers.length);
};
class PeerPool extends events_1.EventEmitter {
    constructor(peerPoolConfig) {
        super();
        this._peerMap = new Map();
        this._peerPoolConfig = peerPoolConfig;
        this._peerConfig = {
            connectTimeout: this._peerPoolConfig.connectTimeout,
            ackTimeout: this._peerPoolConfig.ackTimeout,
            wsMaxMessageRate: this._peerPoolConfig.wsMaxMessageRate,
            wsMaxMessageRatePenalty: this._peerPoolConfig.wsMaxMessageRatePenalty,
            maxPeerDiscoveryResponseLength: this._peerPoolConfig
                .maxPeerDiscoveryResponseLength,
            rateCalculationInterval: this._peerPoolConfig.rateCalculationInterval,
            wsMaxPayload: this._peerPoolConfig.wsMaxPayload,
            maxPeerInfoSize: this._peerPoolConfig.maxPeerInfoSize,
            secret: this._peerPoolConfig.secret,
        };
        this._peerLists = peerPoolConfig.peerLists;
        this._peerSelectForSend = peerPoolConfig.peerSelectionForSend;
        this._peerSelectForRequest = peerPoolConfig.peerSelectionForRequest;
        this._peerSelectForConnection = peerPoolConfig.peerSelectionForConnection;
        this._maxOutboundConnections = peerPoolConfig.maxOutboundConnections;
        this._maxInboundConnections = peerPoolConfig.maxInboundConnections;
        this._sendPeerLimit = peerPoolConfig.sendPeerLimit;
        this._outboundShuffleIntervalId = setInterval(() => {
            this._evictPeer(peer_1.OutboundPeer);
        }, peerPoolConfig.outboundShuffleInterval);
        this._handlePeerRPC = (request) => {
            this.emit(peer_1.EVENT_REQUEST_RECEIVED, request);
        };
        this._handlePeerMessage = (message) => {
            this.emit(peer_1.EVENT_MESSAGE_RECEIVED, message);
        };
        this._handleDiscoverPeer = (peerInfo) => {
            this.emit(peer_1.EVENT_DISCOVERED_PEER, peerInfo);
        };
        this._handleOutboundPeerConnect = async (peerInfo) => {
            this.emit(peer_1.EVENT_CONNECT_OUTBOUND, peerInfo);
        };
        this._handleOutboundPeerConnectAbort = (peerInfo) => {
            this.emit(peer_1.EVENT_CONNECT_ABORT_OUTBOUND, peerInfo);
        };
        this._handlePeerCloseOutbound = (closePacket) => {
            const peerId = utils_1.constructPeerIdFromPeerInfo(closePacket.peerInfo);
            this.removePeer(peerId, closePacket.code, `Outbound peer ${peerId} disconnected with reason: ${closePacket.reason ||
                'Unknown reason'}`);
            this.emit(peer_1.EVENT_CLOSE_OUTBOUND, closePacket);
        };
        this._handlePeerCloseInbound = (closePacket) => {
            const peerId = utils_1.constructPeerIdFromPeerInfo(closePacket.peerInfo);
            this.removePeer(peerId, closePacket.code, `Inbound peer ${peerId} disconnected with reason: ${closePacket.reason ||
                'Unknown reason'}`);
            this.emit(peer_1.EVENT_CLOSE_INBOUND, closePacket);
        };
        this._handlePeerOutboundSocketError = (error) => {
            this.emit(peer_1.EVENT_OUTBOUND_SOCKET_ERROR, error);
        };
        this._handlePeerInboundSocketError = (error) => {
            this.emit(peer_1.EVENT_INBOUND_SOCKET_ERROR, error);
        };
        this._handlePeerInfoUpdate = (peerInfo) => {
            this.emit(peer_1.EVENT_UPDATED_PEER_INFO, peerInfo);
        };
        this._handleFailedPeerInfoUpdate = (error) => {
            this.emit(peer_1.EVENT_FAILED_PEER_INFO_UPDATE, error);
        };
        this._handleFailedToFetchPeerInfo = (error) => {
            this.emit(peer_1.EVENT_FAILED_TO_FETCH_PEER_INFO, error);
        };
        this._handleFailedToFetchPeers = (error) => {
            this.emit(peer_1.EVENT_FAILED_TO_FETCH_PEERS, error);
        };
        this._handleFailedToCollectPeerDetails = (error) => {
            this.emit(peer_1.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT, error);
        };
        this._handleBanPeer = (peerId) => {
            setTimeout(this._handleUnbanPeer.bind(this, peerId), this._peerPoolConfig.peerBanTime);
            this.emit(peer_1.EVENT_BAN_PEER, peerId);
        };
        this._handleUnbanPeer = (peerId) => {
            this.emit(peer_1.EVENT_UNBAN_PEER, peerId);
        };
    }
    applyNodeInfo(nodeInfo) {
        this._nodeInfo = nodeInfo;
        const peerList = this.getPeers();
        peerList.forEach(peer => {
            this._applyNodeInfoOnPeer(peer, nodeInfo);
        });
    }
    get nodeInfo() {
        return this._nodeInfo;
    }
    get peerConfig() {
        return Object.assign({}, this._peerConfig);
    }
    async request(packet) {
        const outboundPeerInfos = this.getUniqueOutboundConnectedPeers().map((peerInfo) => (Object.assign({}, peerInfo, { kind: exports.PEER_KIND_OUTBOUND })));
        const selectedPeers = this._peerSelectForRequest({
            peers: outboundPeerInfos,
            nodeInfo: this._nodeInfo,
            peerLimit: 1,
            requestPacket: packet,
        });
        if (selectedPeers.length <= 0) {
            throw new errors_1.RequestFailError('Request failed due to no peers found in peer selection');
        }
        const selectedPeerId = utils_1.constructPeerIdFromPeerInfo(selectedPeers[0]);
        return this.requestFromPeer(packet, selectedPeerId);
    }
    send(message) {
        const listOfPeerInfo = [...this._peerMap.values()].map((peer) => (Object.assign({}, peer.peerInfo, { kind: peer instanceof peer_1.OutboundPeer ? exports.PEER_KIND_OUTBOUND : exports.PEER_KIND_INBOUND })));
        const selectedPeers = this._peerSelectForSend({
            peers: listOfPeerInfo,
            nodeInfo: this._nodeInfo,
            peerLimit: this._sendPeerLimit,
            messagePacket: message,
        });
        selectedPeers.forEach((peerInfo) => {
            const selectedPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
            try {
                this.sendToPeer(message, selectedPeerId);
            }
            catch (error) {
                this.emit(exports.EVENT_FAILED_TO_SEND_MESSAGE, error);
            }
        });
    }
    async requestFromPeer(packet, peerId) {
        const peer = this._peerMap.get(peerId);
        if (!peer) {
            throw new errors_1.RequestFailError(`Request failed because a peer with id ${peerId} could not be found`);
        }
        return peer.request(packet);
    }
    sendToPeer(message, peerId) {
        const peer = this._peerMap.get(peerId);
        if (!peer) {
            throw new errors_1.SendFailError(`Send failed because a peer with id ${peerId} could not be found`);
        }
        peer.send(message);
    }
    triggerNewConnections(newPeers, triedPeers, fixedPeers) {
        const disconnectedNewPeers = newPeers.filter(newPeer => !this._peerMap.has(utils_1.constructPeerIdFromPeerInfo(newPeer)) ||
            !fixedPeers
                .map(fixedPeer => fixedPeer.ipAddress)
                .includes(newPeer.ipAddress));
        const disconnectedTriedPeers = triedPeers.filter(triedPeer => !this._peerMap.has(utils_1.constructPeerIdFromPeerInfo(triedPeer)) ||
            !fixedPeers
                .map(fixedPeer => fixedPeer.ipAddress)
                .includes(triedPeer.ipAddress));
        const { outboundCount } = this.getPeersCountPerKind();
        const disconnectedFixedPeers = fixedPeers
            .filter(peer => !this._peerMap.get(utils_1.constructPeerIdFromPeerInfo(peer)))
            .map(peer2Convert => peer2Convert);
        const peerLimit = this._maxOutboundConnections -
            disconnectedFixedPeers.length -
            outboundCount;
        const peersToConnect = this._peerSelectForConnection({
            newPeers: disconnectedNewPeers,
            triedPeers: disconnectedTriedPeers,
            peerLimit,
        });
        [...peersToConnect, ...disconnectedFixedPeers].forEach((peerInfo) => {
            const peerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
            const existingPeer = this.getPeer(peerId);
            return existingPeer
                ? existingPeer
                : this.addOutboundPeer(peerId, peerInfo);
        });
    }
    addInboundPeer(peerInfo, socket) {
        const inboundPeers = this.getPeers(peer_1.InboundPeer);
        if (inboundPeers.length >= this._maxInboundConnections) {
            this._evictPeer(peer_1.InboundPeer);
        }
        const peer = new peer_1.InboundPeer(peerInfo, socket, Object.assign({}, this._peerConfig));
        if (this._peerMap.has(peer.id)) {
            throw new Error(`Peer ${peer.id} was already in the peer pool`);
        }
        this._peerMap.set(peer.id, peer);
        this._bindHandlersToPeer(peer);
        if (this._nodeInfo) {
            this._applyNodeInfoOnPeer(peer, this._nodeInfo);
        }
        peer.connect();
        return peer;
    }
    addOutboundPeer(peerId, peerInfo) {
        const existingPeer = this.getPeer(peerId);
        if (existingPeer) {
            return existingPeer;
        }
        const peer = new peer_1.OutboundPeer(peerInfo, Object.assign({}, this._peerConfig));
        this._peerMap.set(peer.id, peer);
        this._bindHandlersToPeer(peer);
        if (this._nodeInfo) {
            this._applyNodeInfoOnPeer(peer, this._nodeInfo);
        }
        return peer;
    }
    getPeersCountPerKind() {
        return [...this._peerMap.values()].reduce((prev, peer) => {
            if (peer instanceof peer_1.OutboundPeer) {
                return {
                    outboundCount: prev.outboundCount + 1,
                    inboundCount: prev.inboundCount,
                };
            }
            else if (peer instanceof peer_1.InboundPeer) {
                return {
                    outboundCount: prev.outboundCount,
                    inboundCount: prev.inboundCount + 1,
                };
            }
            throw new Error('A non-identified peer exists in the pool.');
        }, { outboundCount: 0, inboundCount: 0 });
    }
    removeAllPeers() {
        if (this._outboundShuffleIntervalId) {
            clearInterval(this._outboundShuffleIntervalId);
        }
        this._peerMap.forEach((peer) => {
            this.removePeer(peer.id, exports.INTENTIONAL_DISCONNECT_STATUS_CODE, `Intentionally removed peer ${peer.id}`);
        });
    }
    getPeers(kind) {
        const peers = [...this._peerMap.values()];
        if (kind) {
            return peers.filter(peer => peer instanceof kind);
        }
        return peers;
    }
    getUniqueOutboundConnectedPeers() {
        return peer_selection_1.getUniquePeersbyIp(this.getAllConnectedPeerInfos(peer_1.OutboundPeer));
    }
    getAllConnectedPeerInfos(kind) {
        return this.getConnectedPeers(kind).map(peer => peer.peerInfo);
    }
    getConnectedPeers(kind) {
        const peers = [...this._peerMap.values()];
        if (kind) {
            return peers.filter(peer => peer instanceof kind && peer.state === peer_1.ConnectionState.OPEN);
        }
        return peers.filter(peer => peer.state === peer_1.ConnectionState.OPEN);
    }
    getPeer(peerId) {
        return this._peerMap.get(peerId);
    }
    hasPeer(peerId) {
        return this._peerMap.has(peerId);
    }
    removePeer(peerId, code, reason) {
        const peer = this._peerMap.get(peerId);
        if (peer) {
            peer.disconnect(code, reason);
            this._unbindHandlersFromPeer(peer);
        }
        this.emit(exports.EVENT_REMOVE_PEER, peerId);
        return this._peerMap.delete(peerId);
    }
    applyPenalty(peerPenalty) {
        const peer = this._peerMap.get(peerPenalty.peerId);
        if (peer) {
            peer.applyPenalty(peerPenalty.penalty);
            return;
        }
        throw new Error('Peer not found');
    }
    _applyNodeInfoOnPeer(peer, nodeInfo) {
        (async () => {
            try {
                await peer.applyNodeInfo(nodeInfo);
            }
            catch (error) {
                this.emit(peer_1.EVENT_FAILED_TO_PUSH_NODE_INFO, error);
            }
        })();
    }
    _selectPeersForEviction() {
        const peers = [...this.getPeers(peer_1.InboundPeer)].filter(peer => this._peerLists.whitelisted.every(p => utils_1.constructPeerIdFromPeerInfo(p) !== peer.id));
        const filteredPeersByNetgroup = this._peerPoolConfig.netgroupProtectionRatio
            ? filterPeersByCategory(peers, {
                category: PROTECTION_CATEGORY.NET_GROUP,
                percentage: this._peerPoolConfig.netgroupProtectionRatio,
                asc: true,
            })
            : peers;
        if (filteredPeersByNetgroup.length <= 1) {
            return filteredPeersByNetgroup;
        }
        const filteredPeersByLatency = this._peerPoolConfig.latencyProtectionRatio
            ? filterPeersByCategory(peers, {
                category: PROTECTION_CATEGORY.LATENCY,
                percentage: this._peerPoolConfig.latencyProtectionRatio,
                asc: true,
            })
            : filteredPeersByNetgroup;
        if (filteredPeersByLatency.length <= 1) {
            return filteredPeersByLatency;
        }
        const filteredPeersByResponseRate = this._peerPoolConfig
            .productivityProtectionRatio
            ? filterPeersByCategory(filteredPeersByLatency, {
                category: PROTECTION_CATEGORY.RESPONSE_RATE,
                percentage: this._peerPoolConfig.productivityProtectionRatio,
                asc: false,
            })
            : filteredPeersByLatency;
        if (filteredPeersByResponseRate.length <= 1) {
            return filteredPeersByResponseRate;
        }
        const filteredPeersByConnectTime = this._peerPoolConfig
            .longevityProtectionRatio
            ? filterPeersByCategory(filteredPeersByResponseRate, {
                category: PROTECTION_CATEGORY.CONNECT_TIME,
                percentage: this._peerPoolConfig.longevityProtectionRatio,
                asc: true,
            })
            : filteredPeersByResponseRate;
        return filteredPeersByConnectTime;
    }
    _evictPeer(kind) {
        const peers = this.getPeers(kind);
        if (peers.length < 1) {
            return;
        }
        if (kind === peer_1.OutboundPeer) {
            const selectedPeer = shuffle(peers.filter(peer => this._peerLists.fixedPeers.every(p => utils_1.constructPeerIdFromPeerInfo(p) !== peer.id)))[0];
            if (selectedPeer) {
                this.removePeer(selectedPeer.id, disconnect_status_codes_1.EVICTED_PEER_CODE, `Evicted outbound peer ${selectedPeer.id}`);
            }
        }
        if (kind === peer_1.InboundPeer) {
            const evictionCandidates = this._selectPeersForEviction();
            const peerToEvict = shuffle(evictionCandidates)[0];
            if (peerToEvict) {
                this.removePeer(peerToEvict.id, disconnect_status_codes_1.EVICTED_PEER_CODE, `Evicted inbound peer ${peerToEvict.id}`);
            }
        }
    }
    _bindHandlersToPeer(peer) {
        peer.on(peer_1.EVENT_REQUEST_RECEIVED, this._handlePeerRPC);
        peer.on(peer_1.EVENT_MESSAGE_RECEIVED, this._handlePeerMessage);
        peer.on(peer_1.EVENT_CONNECT_OUTBOUND, this._handleOutboundPeerConnect);
        peer.on(peer_1.EVENT_CONNECT_ABORT_OUTBOUND, this._handleOutboundPeerConnectAbort);
        peer.on(peer_1.EVENT_CLOSE_OUTBOUND, this._handlePeerCloseOutbound);
        peer.on(peer_1.EVENT_CLOSE_INBOUND, this._handlePeerCloseInbound);
        peer.on(peer_1.EVENT_OUTBOUND_SOCKET_ERROR, this._handlePeerOutboundSocketError);
        peer.on(peer_1.EVENT_INBOUND_SOCKET_ERROR, this._handlePeerInboundSocketError);
        peer.on(peer_1.EVENT_UPDATED_PEER_INFO, this._handlePeerInfoUpdate);
        peer.on(peer_1.EVENT_FAILED_PEER_INFO_UPDATE, this._handleFailedPeerInfoUpdate);
        peer.on(peer_1.EVENT_FAILED_TO_FETCH_PEER_INFO, this._handleFailedToFetchPeerInfo);
        peer.on(peer_1.EVENT_FAILED_TO_FETCH_PEERS, this._handleFailedToFetchPeers);
        peer.on(peer_1.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT, this._handleFailedToCollectPeerDetails);
        peer.on(peer_1.EVENT_BAN_PEER, this._handleBanPeer);
        peer.on(peer_1.EVENT_UNBAN_PEER, this._handleUnbanPeer);
        peer.on(peer_1.EVENT_DISCOVERED_PEER, this._handleDiscoverPeer);
    }
    _unbindHandlersFromPeer(peer) {
        peer.removeListener(peer_1.EVENT_REQUEST_RECEIVED, this._handlePeerRPC);
        peer.removeListener(peer_1.EVENT_MESSAGE_RECEIVED, this._handlePeerMessage);
        peer.removeListener(peer_1.EVENT_CONNECT_OUTBOUND, this._handleOutboundPeerConnect);
        peer.removeListener(peer_1.EVENT_CONNECT_ABORT_OUTBOUND, this._handleOutboundPeerConnectAbort);
        peer.removeListener(peer_1.EVENT_CLOSE_OUTBOUND, this._handlePeerCloseOutbound);
        peer.removeListener(peer_1.EVENT_CLOSE_INBOUND, this._handlePeerCloseInbound);
        peer.removeListener(peer_1.EVENT_UPDATED_PEER_INFO, this._handlePeerInfoUpdate);
        peer.removeListener(peer_1.EVENT_FAILED_TO_FETCH_PEER_INFO, this._handleFailedToFetchPeerInfo);
        peer.removeListener(peer_1.EVENT_FAILED_TO_FETCH_PEERS, this._handleFailedToFetchPeers);
        peer.removeListener(peer_1.EVENT_FAILED_PEER_INFO_UPDATE, this._handleFailedPeerInfoUpdate);
        peer.removeListener(peer_1.EVENT_FAILED_TO_COLLECT_PEER_DETAILS_ON_CONNECT, this._handleFailedToCollectPeerDetails);
        peer.removeListener(peer_1.EVENT_BAN_PEER, this._handleBanPeer);
        peer.removeListener(peer_1.EVENT_UNBAN_PEER, this._handleUnbanPeer);
        peer.removeListener(peer_1.EVENT_DISCOVERED_PEER, this._handleDiscoverPeer);
    }
}
exports.PeerPool = PeerPool;
//# sourceMappingURL=peer_pool.js.map