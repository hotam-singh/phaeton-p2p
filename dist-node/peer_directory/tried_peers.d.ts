import { P2PDiscoveredPeerInfo, P2PPeerInfo } from '../p2p_types';
export declare const DEFAULT_TRIED_PEER_LIST_SIZE = 64;
export declare const DEFAULT_TRIED_PEER_BUCKET_SIZE = 32;
export declare const DEFAULT_MAX_RECONNECT_TRIES = 3;
export interface TriedPeerConfig {
    readonly triedPeerBucketCount?: number;
    readonly triedPeerBucketSize?: number;
    readonly maxReconnectTries?: number;
    readonly secret: number;
}
export interface AddPeerOutcome {
    readonly success: boolean;
    readonly evicted: boolean;
    readonly evictedPeer?: P2PPeerInfo;
}
export declare class TriedPeers {
    private readonly _triedPeerMap;
    private readonly _triedPeerBucketCount;
    private readonly _triedPeerBucketSize;
    private readonly _maxReconnectTries;
    private readonly _secret;
    constructor({ triedPeerBucketCount, maxReconnectTries, secret, triedPeerBucketSize, }: TriedPeerConfig);
    readonly triedPeerConfig: TriedPeerConfig;
    triedPeersList(): ReadonlyArray<P2PDiscoveredPeerInfo>;
    getBucketId(ipAddress: string): number;
    updatePeer(peerInfo: P2PDiscoveredPeerInfo): boolean;
    removePeer(peerInfo: P2PPeerInfo): boolean;
    getPeer(peerInfo: P2PPeerInfo): P2PDiscoveredPeerInfo | undefined;
    addPeer(peerInfo: P2PDiscoveredPeerInfo): AddPeerOutcome;
    failedConnectionAction(incomingPeerInfo: P2PPeerInfo): boolean;
    private _evictPeer;
}
