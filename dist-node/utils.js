"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const phaeton_cryptography_1 = require("@phaetonhq/phaeton-cryptography");
const net_1 = require("net");
const SECRET_BUFFER_LENGTH = 4;
const NETWORK_BUFFER_LENGTH = 1;
const PREFIX_BUFFER_LENGTH = 1;
const BYTES_4 = 4;
const BYTES_16 = 16;
const BYTES_64 = 64;
const BYTES_128 = 128;
var NETWORK;
(function (NETWORK) {
    NETWORK[NETWORK["NET_IPV4"] = 0] = "NET_IPV4";
    NETWORK[NETWORK["NET_PRIVATE"] = 1] = "NET_PRIVATE";
    NETWORK[NETWORK["NET_LOCAL"] = 2] = "NET_LOCAL";
    NETWORK[NETWORK["NET_OTHER"] = 3] = "NET_OTHER";
})(NETWORK = exports.NETWORK || (exports.NETWORK = {}));
var PEER_TYPE;
(function (PEER_TYPE) {
    PEER_TYPE["NEW_PEER"] = "newPeer";
    PEER_TYPE["TRIED_PEER"] = "triedPeer";
})(PEER_TYPE = exports.PEER_TYPE || (exports.PEER_TYPE = {}));
exports.getIPGroup = (address, groupNumber) => {
    if (groupNumber > 3) {
        throw new Error('Invalid IP group.');
    }
    return parseInt(address.split('.')[groupNumber], 10);
};
exports.getIPBytes = (address) => {
    const aBytes = Buffer.alloc(PREFIX_BUFFER_LENGTH);
    aBytes.writeUInt8(exports.getIPGroup(address, 0), 0);
    const bBytes = Buffer.alloc(PREFIX_BUFFER_LENGTH);
    bBytes.writeUInt8(exports.getIPGroup(address, 1), 0);
    const cBytes = Buffer.alloc(PREFIX_BUFFER_LENGTH);
    cBytes.writeUInt8(exports.getIPGroup(address, 2), 0);
    const dBytes = Buffer.alloc(PREFIX_BUFFER_LENGTH);
    dBytes.writeUInt8(exports.getIPGroup(address, 3), 0);
    return {
        aBytes,
        bBytes,
        cBytes,
        dBytes,
    };
};
exports.isPrivate = (address) => exports.getIPGroup(address, 0) === 10 ||
    (exports.getIPGroup(address, 0) === 172 &&
        (exports.getIPGroup(address, 1) >= 16 || exports.getIPGroup(address, 1) <= 31));
exports.isLocal = (address) => exports.getIPGroup(address, 0) === 127 || exports.getIPGroup(address, 0) === 0;
exports.getNetwork = (address) => {
    if (exports.isLocal(address)) {
        return NETWORK.NET_LOCAL;
    }
    if (exports.isPrivate(address)) {
        return NETWORK.NET_PRIVATE;
    }
    if (net_1.isIPv4(address)) {
        return NETWORK.NET_IPV4;
    }
    return NETWORK.NET_OTHER;
};
exports.getNetgroup = (address, secret) => {
    const secretBytes = Buffer.alloc(SECRET_BUFFER_LENGTH);
    secretBytes.writeUInt32BE(secret, 0);
    const network = exports.getNetwork(address);
    const networkBytes = Buffer.alloc(NETWORK_BUFFER_LENGTH);
    networkBytes.writeUInt8(network, 0);
    const { aBytes, bBytes } = exports.getIPBytes(address);
    if (network === NETWORK.NET_OTHER) {
        throw Error('IP address is unsupported.');
    }
    const netgroupBytes = Buffer.concat([
        secretBytes,
        networkBytes,
        aBytes,
        bBytes,
    ]);
    return phaeton_cryptography_1.hash(netgroupBytes).readUInt32BE(0);
};
exports.getBucket = (options) => {
    const { secret, targetAddress, peerType } = options;
    const firstMod = peerType === PEER_TYPE.NEW_PEER ? BYTES_16 : BYTES_4;
    const secondMod = peerType === PEER_TYPE.NEW_PEER ? BYTES_128 : BYTES_64;
    const secretBytes = Buffer.alloc(SECRET_BUFFER_LENGTH);
    secretBytes.writeUInt32BE(secret, 0);
    const network = exports.getNetwork(targetAddress);
    const networkBytes = Buffer.alloc(NETWORK_BUFFER_LENGTH);
    networkBytes.writeUInt8(network, 0);
    const { aBytes: targetABytes, bBytes: targetBBytes, cBytes: targetCBytes, dBytes: targetDBytes, } = exports.getIPBytes(targetAddress);
    if (network === NETWORK.NET_OTHER) {
        throw Error('IP address is unsupported.');
    }
    if (network !== NETWORK.NET_IPV4) {
        return (phaeton_cryptography_1.hash(Buffer.concat([secretBytes, networkBytes])).readUInt32BE(0) %
            secondMod);
    }
    const addressBytes = Buffer.concat([
        targetABytes,
        targetBBytes,
        targetCBytes,
        targetDBytes,
    ]);
    const kBytes = Buffer.alloc(firstMod);
    const k = peerType === PEER_TYPE.NEW_PEER
        ? phaeton_cryptography_1.hash(Buffer.concat([
            secretBytes,
            networkBytes,
            targetABytes,
            targetBBytes,
        ])).readUInt32BE(0) % firstMod
        : phaeton_cryptography_1.hash(Buffer.concat([secretBytes, networkBytes, addressBytes])).readUInt32BE(0) % firstMod;
    kBytes.writeUInt32BE(k, 0);
    const bucketBytes = Buffer.concat([
        secretBytes,
        networkBytes,
        targetABytes,
        targetBBytes,
        kBytes,
    ]);
    return phaeton_cryptography_1.hash(bucketBytes).readUInt32BE(0) % secondMod;
};
exports.constructPeerIdFromPeerInfo = (peerInfo) => `${peerInfo.ipAddress}:${peerInfo.wsPort}`;
//# sourceMappingURL=utils.js.map
