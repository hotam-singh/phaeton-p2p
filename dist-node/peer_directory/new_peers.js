"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../utils");
exports.DEFAULT_NEW_PEER_BUCKET_COUNT = 128;
exports.DEFAULT_NEW_PEER_BUCKET_SIZE = 32;
exports.DEFAULT_EVICTION_THRESHOLD_TIME = 86400000;
class NewPeers {
    constructor({ evictionThresholdTime: eligibleDaysForEviction, newPeerBucketSize, newPeerBucketCount, secret, }) {
        this._newPeerBucketSize = newPeerBucketSize
            ? newPeerBucketSize
            : exports.DEFAULT_NEW_PEER_BUCKET_SIZE;
        this._newPeerBucketCount = newPeerBucketCount
            ? newPeerBucketCount
            : exports.DEFAULT_NEW_PEER_BUCKET_COUNT;
        this._evictionThresholdTime = eligibleDaysForEviction
            ? eligibleDaysForEviction
            : exports.DEFAULT_EVICTION_THRESHOLD_TIME;
        this._secret = secret;
        this._newPeerMap = new Map();
        for (const bucketId of [...new Array(this._newPeerBucketCount).keys()]) {
            this._newPeerMap.set(bucketId, new Map());
        }
    }
    get newPeerConfig() {
        return {
            newPeerBucketSize: this._newPeerBucketSize,
            newPeerBucketCount: this._newPeerBucketCount,
            secret: this._secret,
        };
    }
    newPeersList() {
        const peersListMap = [];
        for (const peerMap of [...this._newPeerMap.values()]) {
            for (const peer of [...peerMap.values()]) {
                peersListMap.push(peer.peerInfo);
            }
        }
        return peersListMap;
    }
    getBucketId(ipAddress) {
        return utils_1.getBucket({
            secret: this._secret,
            peerType: utils_1.PEER_TYPE.NEW_PEER,
            targetAddress: ipAddress,
        });
    }
    updatePeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._newPeerMap.get(bucketId);
        if (!bucket) {
            return false;
        }
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        const foundPeer = bucket.get(incomingPeerId);
        if (!foundPeer) {
            return false;
        }
        const updatedNewPeerInfo = {
            peerInfo: Object.assign({}, foundPeer.peerInfo, peerInfo),
            dateAdded: foundPeer.dateAdded,
        };
        bucket.set(incomingPeerId, updatedNewPeerInfo);
        this._newPeerMap.set(bucketId, bucket);
        return true;
    }
    removePeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._newPeerMap.get(bucketId);
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        if (bucket && bucket.get(incomingPeerId)) {
            const success = bucket.delete(incomingPeerId);
            this._newPeerMap.set(bucketId, bucket);
            return success;
        }
        return false;
    }
    getPeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._newPeerMap.get(bucketId);
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        if (!bucket) {
            return undefined;
        }
        const newPeer = bucket.get(incomingPeerId);
        return newPeer ? newPeer.peerInfo : undefined;
    }
    addPeer(peerInfo) {
        const bucketId = this.getBucketId(peerInfo.ipAddress);
        const bucket = this._newPeerMap.get(bucketId);
        const incomingPeerId = utils_1.constructPeerIdFromPeerInfo(peerInfo);
        if (!bucket) {
            return {
                success: false,
                isEvicted: false,
            };
        }
        if (bucket && bucket.get(incomingPeerId)) {
            return {
                success: false,
                isEvicted: false,
            };
        }
        const newPeerInfo = {
            peerInfo,
            numOfConnectionFailures: 0,
            dateAdded: new Date(),
        };
        if (bucket.size < this._newPeerBucketSize) {
            bucket.set(incomingPeerId, newPeerInfo);
            this._newPeerMap.set(bucketId, bucket);
            return {
                success: true,
                isEvicted: false,
            };
        }
        const evictedPeer = this._evictPeer(bucketId);
        bucket.set(incomingPeerId, newPeerInfo);
        this._newPeerMap.set(bucketId, bucket);
        return {
            success: true,
            isEvicted: true,
            evictedPeer: evictedPeer.peerInfo,
        };
    }
    failedConnectionAction(incomingPeerInfo) {
        const success = this.removePeer(incomingPeerInfo);
        return success;
    }
    _evictPeer(bucketId) {
        const peerList = this._newPeerMap.get(bucketId);
        if (!peerList) {
            throw new Error(`No Peer list for bucket Id: ${bucketId}`);
        }
        const evictedPeerBasedOnTime = this._evictionBasedOnTimeInBucket(bucketId, peerList);
        if (evictedPeerBasedOnTime) {
            return evictedPeerBasedOnTime;
        }
        return this._evictionRandom(bucketId);
    }
    _evictionBasedOnTimeInBucket(bucketId, peerList) {
        let evictedPeer;
        [...this._newPeerMap.values()].forEach(peersMap => {
            [...peersMap.keys()].forEach(peerId => {
                const peer = peersMap.get(peerId);
                if (!peer) {
                    return;
                }
                const timeDifference = Math.round(Math.abs(peer.dateAdded.getTime() - new Date().getTime()));
                if (timeDifference >= this._evictionThresholdTime) {
                    peerList.delete(peerId);
                    this._newPeerMap.set(bucketId, peerList);
                    evictedPeer = peer;
                }
            });
        });
        return evictedPeer;
    }
    _evictionRandom(bucketId) {
        const peerList = this._newPeerMap.get(bucketId);
        if (!peerList) {
            throw new Error(`No Peers exist for bucket Id: ${bucketId}`);
        }
        const randomPeerIndex = Math.floor(Math.random() * this._newPeerBucketSize);
        const randomPeerId = Array.from(peerList.keys())[randomPeerIndex];
        const randomPeer = Array.from(peerList.values())[randomPeerIndex];
        peerList.delete(randomPeerId);
        this._newPeerMap.set(bucketId, peerList);
        return randomPeer;
    }
}
exports.NewPeers = NewPeers;
//# sourceMappingURL=new_peers.js.map