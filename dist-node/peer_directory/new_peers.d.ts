import { P2PPeerInfo } from '../p2p_types';
export declare const DEFAULT_NEW_PEER_BUCKET_COUNT = 128;
export declare const DEFAULT_NEW_PEER_BUCKET_SIZE = 32;
export declare const DEFAULT_EVICTION_THRESHOLD_TIME = 86400000;
export interface NewPeerConfig {
    readonly evictionThresholdTime?: number;
    readonly newPeerBucketCount?: number;
    readonly newPeerBucketSize?: number;
    readonly secret: number;
}
export interface AddPeerOutcome {
    readonly success: boolean;
    readonly isEvicted: boolean;
    readonly evictedPeer?: P2PPeerInfo;
}
export declare class NewPeers {
    private readonly _newPeerMap;
    private readonly _newPeerBucketCount;
    private readonly _newPeerBucketSize;
    private readonly _evictionThresholdTime;
    private readonly _secret;
    constructor({ evictionThresholdTime: eligibleDaysForEviction, newPeerBucketSize, newPeerBucketCount, secret, }: NewPeerConfig);
    readonly newPeerConfig: NewPeerConfig;
    newPeersList(): ReadonlyArray<P2PPeerInfo>;
    getBucketId(ipAddress: string): number;
    updatePeer(peerInfo: P2PPeerInfo): boolean;
    removePeer(peerInfo: P2PPeerInfo): boolean;
    getPeer(peerInfo: P2PPeerInfo): P2PPeerInfo | undefined;
    addPeer(peerInfo: P2PPeerInfo): AddPeerOutcome;
    failedConnectionAction(incomingPeerInfo: P2PPeerInfo): boolean;
    private _evictPeer;
    private _evictionBasedOnTimeInBucket;
    private _evictionRandom;
}
