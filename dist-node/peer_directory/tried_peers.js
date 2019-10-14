"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../utils");
exports.DEFAULT_TRIED_PEER_LIST_SIZE = 64;
exports.DEFAULT_TRIED_PEER_BUCKET_SIZE = 32;
exports.DEFAULT_MAX_RECONNECT_TRIES = 3;
class TriedPeers {
    constructor({ triedPeerBucketCount, maxReconnectTries, secret, triedPeerBucketSize, }) {
        this._triedPeerBucketCount = triedPeerBucketCount
            ? triedPeerBucketCount
            : exports.DEFAULT_TRIED_PEER_LIST_SIZE;
        this._triedPeerBucketSize = triedPeerBucketSize
            ? triedPeerBucketSize
            : exports.DEFAULT_TRIED_PEER_BUCKET_SIZE;
        this._maxReconnectTries = maxReconnectTries
            ? maxReconnectTries
            : exports.DEFAULT_MAX_RECONNECT_TRIES;
        this._secret = secret;
        this._triedPeerMap = new Map();
        for (const bucketId of [...new Array(this._triedPeerBucketCount).keys()]) {
            this._triedPeerMap.set(bucketId, new Map());
        }
    }
    get triedPeerConfig() {
        return {
            maxReconnectTries: this._maxReconnectTries,
            triedPeerBucketSize: this._triedPeerBucketSize,
            triedPeerBucketCount: this._triedPeerBucketCount,
            secret: this._secret,
        };
    }
    triedPeersList() {
        const peersListMap = [];
        for (const peerMap of [...this._triedPeerMap.values()]) {
            for (const peer of [...peerMap.values()]) {
                peersListMap.push(peer.peerInfo);
            }
        }
        return peersListMap;
    }
    getBucketId(ipAddress) {
        return utils_1.getBucket({
            secret: this._secret,
            peerType: utils_1.PEER_TYPE.TRIED_PEER,
            targetAddress: ipAddress,
        });
    }
    updatePeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._triedPeerMap.get(bucketId);
        if (!bucket) {
            return false;
        }
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        const foundPeer = bucket.get(incomingPeerId);
        if (!foundPeer) {
            return false;
        }
        const updatedTriedPeerInfo = {
            peerInfo: Object.assign({}, foundPeer.peerInfo, peerInfo),
            dateAdded: foundPeer.dateAdded,
            numOfConnectionFailures: foundPeer.numOfConnectionFailures,
        };
        bucket.set(incomingPeerId, updatedTriedPeerInfo);
        this._triedPeerMap.set(bucketId, bucket);
        return true;
    }
    removePeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._triedPeerMap.get(bucketId);
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        if (bucket && bucket.get(incomingPeerId)) {
            const success = bucket.delete(incomingPeerId);
            this._triedPeerMap.set(bucketId, bucket);
            return success;
        }
        return false;
    }
    getPeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._triedPeerMap.get(bucketId);
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        if (!bucket) {
            return undefined;
        }
        const triedPeer = bucket.get(incomingPeerId);
        return triedPeer ? triedPeer.peerInfo : undefined;
    }
    addPeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._triedPeerMap.get(bucketId);
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        if (!bucket) {
            return {
                success: false,
                evicted: false,
            };
        }
        if (bucket && bucket.get(incomingPeerId)) {
            return {
                success: false,
                evicted: false,
            };
        }
        const newTriedPeerInfo = {
            peerInfo,
            numOfConnectionFailures: 0,
            dateAdded: new Date(),
        };
        if (bucket.size < this._triedPeerBucketSize) {
            bucket.set(incomingPeerId, newTriedPeerInfo);
            this._triedPeerMap.set(bucketId, bucket);
            return {
                success: true,
                evicted: false,
            };
        }
        const evictedPeer = this._evictPeer(bucketId);
        bucket.set(incomingPeerId, newTriedPeerInfo);
        this._triedPeerMap.set(bucketId, bucket);
        return {
            success: true,
            evicted: true,
            evictedPeer: evictedPeer.peerInfo,
        };
    }
    failedConnectionAction(incomingPeerInfo) {
        const bucketId = this.getBucketId(incomingPeerInfo.ipAddress);
        const bucket = this._triedPeerMap.get(bucketId);
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(incomingPeerInfo);
        if (!bucket) {
            return false;
        }
        const foundPeer = bucket.get(incomingPeerId);
        if (!foundPeer) {
            return false;
        }
        const { peerInfo, numOfConnectionFailures, dateAdded } = foundPeer;
        if (numOfConnectionFailures + 1 >= this._maxReconnectTries) {
            bucket.delete(incomingPeerId);
            this._triedPeerMap.set(bucketId, bucket);
            return true;
        }
        const newTriedPeerInfo = {
            peerInfo,
            numOfConnectionFailures: numOfConnectionFailures + 1,
            dateAdded,
        };
        bucket.set(incomingPeerId, newTriedPeerInfo);
        this._triedPeerMap.set(bucketId, bucket);
        return false;
    }
    _evictPeer(bucketId) {
        const peerList = this._triedPeerMap.get(bucketId);
        if (!peerList) {
            throw new Error(`No Peers exist for bucket Id: ${bucketId}`);
        }
        const randomPeerIndex = Math.floor(Math.random() * this._triedPeerBucketSize);
        const randomPeerId = Array.from(peerList.keys())[randomPeerIndex];
        const randomPeer = Array.from(peerList.values())[randomPeerIndex];
        peerList.delete(randomPeerId);
        this._triedPeerMap.set(bucketId, peerList);
        return randomPeer;
    }
}
exports.TriedPeers = TriedPeers;
//# sourceMappingURL=tried_peers.js.map