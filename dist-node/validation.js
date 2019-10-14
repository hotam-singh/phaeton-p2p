"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0)
            t[p[i]] = s[p[i]];
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const semver_1 = require("semver");
const validator_1 = require("validator");
const errors_1 = require("./errors");
const disconnect_status_codes_1 = require("./disconnect_status_codes");
const utils_1 = require("./utils");
const IPV4_NUMBER = 4;
const IPV6_NUMBER = 6;
exports.getByteSize = (object) => Buffer.byteLength(JSON.stringify(object));
exports.validatePeerAddress = (ip, wsPort) => {
    if ((!validator_1.isIP(ip, IPV4_NUMBER) && !validator_1.isIP(ip, IPV6_NUMBER)) ||
        !validator_1.isPort(wsPort.toString())) {
        return false;
    }
    return true;
};
exports.incomingPeerInfoSanitization = (peerInfo) => {
    const { ip } = peerInfo, restOfPeerInfo = __rest(peerInfo, ["ip"]);
    return Object.assign({ ipAddress: ip }, restOfPeerInfo);
};
exports.outgoingPeerInfoSanitization = (peerInfo) => {
    const { ipAddress } = peerInfo, restOfPeerInfo = __rest(peerInfo, ["ipAddress"]);
    return Object.assign({ ip: ipAddress }, restOfPeerInfo);
};
exports.validatePeerInfoSchema = (rawPeerInfo) => {
    if (!rawPeerInfo) {
        throw new errors_1.InvalidPeerError(`Invalid peer object`);
    }
    const protocolPeer = rawPeerInfo;
    if (!protocolPeer.ip ||
        !protocolPeer.wsPort ||
        !exports.validatePeerAddress(protocolPeer.ip, protocolPeer.wsPort)) {
        throw new errors_1.InvalidPeerError(`Invalid peer ip or port for peer with ip: ${protocolPeer.ip} and wsPort ${protocolPeer.wsPort}`);
    }
    if (!protocolPeer.version || !semver_1.valid(protocolPeer.version)) {
        throw new errors_1.InvalidPeerError(`Invalid peer version for peer with ip: ${protocolPeer.ip}, wsPort ${protocolPeer.wsPort} and version ${protocolPeer.version}`);
    }
    const version = protocolPeer.version;
    const protocolVersion = protocolPeer.protocolVersion;
    const wsPort = +protocolPeer.wsPort;
    const os = protocolPeer.os ? protocolPeer.os : '';
    const height = protocolPeer.height && validator_1.isNumeric(protocolPeer.height.toString())
        ? +protocolPeer.height
        : 0;
    const { options } = protocolPeer, protocolPeerWithoutOptions = __rest(protocolPeer, ["options"]);
    const peerInfo = Object.assign({}, protocolPeerWithoutOptions, { ipAddress: protocolPeerWithoutOptions.ip, wsPort,
        height,
        os,
        version,
        protocolVersion });
    const { ip } = peerInfo, peerInfoUpdated = __rest(peerInfo, ["ip"]);
    return peerInfoUpdated;
};
exports.validatePeerInfo = (rawPeerInfo, maxByteSize) => {
    const byteSize = exports.getByteSize(rawPeerInfo);
    if (byteSize > maxByteSize) {
        throw new errors_1.InvalidRPCResponseError(`PeerInfo was larger than the maximum allowed ${maxByteSize} bytes`);
    }
    return exports.validatePeerInfoSchema(rawPeerInfo);
};
exports.validatePeersInfoList = (rawBasicPeerInfoList, maxPeerInfoListLength, maxPeerInfoByteSize) => {
    if (!rawBasicPeerInfoList) {
        throw new errors_1.InvalidRPCResponseError('Invalid response type');
    }
    const { peers } = rawBasicPeerInfoList;
    if (Array.isArray(peers)) {
        if (peers.length > maxPeerInfoListLength) {
            throw new errors_1.InvalidRPCResponseError('PeerInfo list was too long');
        }
        const cleanPeerList = peers.filter(peerInfo => exports.getByteSize(peerInfo) < maxPeerInfoByteSize);
        const sanitizedPeerList = cleanPeerList.map(exports.validatePeerInfoSchema);
        return sanitizedPeerList;
    }
    else {
        throw new errors_1.InvalidRPCResponseError('Invalid response type');
    }
};
exports.validateRPCRequest = (request) => {
    if (!request) {
        throw new errors_1.InvalidRPCRequestError('Invalid request');
    }
    const rpcRequest = request;
    if (typeof rpcRequest.procedure !== 'string') {
        throw new errors_1.InvalidRPCRequestError('Request procedure name is not a string');
    }
    return rpcRequest;
};
exports.validateProtocolMessage = (message) => {
    if (!message) {
        throw new errors_1.InvalidProtocolMessageError('Invalid message');
    }
    const protocolMessage = message;
    if (typeof protocolMessage.event !== 'string') {
        throw new errors_1.InvalidProtocolMessageError('Protocol message is not a string');
    }
    return protocolMessage;
};
exports.checkNetworkCompatibility = (peerInfo, nodeInfo) => {
    if (!peerInfo.nethash) {
        return false;
    }
    return peerInfo.nethash === nodeInfo.nethash;
};
exports.checkProtocolVersionCompatibility = (peerInfo, nodeInfo) => {
    if (!peerInfo.protocolVersion) {
        try {
            return semver_1.gte(peerInfo.version, nodeInfo.minVersion);
        }
        catch (error) {
            return false;
        }
    }
    if (typeof peerInfo.protocolVersion !== 'string') {
        return false;
    }
    const peerHardForks = parseInt(peerInfo.protocolVersion.split('.')[0], 10);
    const systemHardForks = parseInt(nodeInfo.protocolVersion.split('.')[0], 10);
    return systemHardForks === peerHardForks && peerHardForks >= 1;
};
exports.checkPeerCompatibility = (peerInfo, nodeInfo) => {
    if (!exports.checkNetworkCompatibility(peerInfo, nodeInfo)) {
        return {
            success: false,
            errors: [disconnect_status_codes_1.INCOMPATIBLE_NETWORK_REASON],
        };
    }
    if (!exports.checkProtocolVersionCompatibility(peerInfo, nodeInfo)) {
        return {
            success: false,
            errors: [disconnect_status_codes_1.INCOMPATIBLE_PROTOCOL_VERSION_REASON],
        };
    }
    return {
        success: true,
    };
};
exports.sanitizePeerLists = (lists, nodeInfo) => {
    const blacklistedPeers = lists.blacklistedPeers.filter(peerInfo => {
        if (peerInfo.ipAddress === nodeInfo.ipAddress) {
            return false;
        }
        return true;
    });
    const blacklistedIPs = blacklistedPeers.map(peerInfo => peerInfo.ipAddress);
    const seedPeers = lists.seedPeers.filter(peerInfo => {
        if (peerInfo.ipAddress === nodeInfo.ipAddress) {
            return false;
        }
        if (blacklistedIPs.includes(peerInfo.ipAddress)) {
            return false;
        }
        return true;
    });
    const fixedPeers = lists.fixedPeers.filter(peerInfo => {
        if (peerInfo.ipAddress === nodeInfo.ipAddress) {
            return false;
        }
        if (blacklistedIPs.includes(peerInfo.ipAddress)) {
            return false;
        }
        return true;
    });
    const whitelisted = lists.whitelisted.filter(peerInfo => {
        if (peerInfo.ipAddress === nodeInfo.ipAddress) {
            return false;
        }
        if (blacklistedIPs.includes(peerInfo.ipAddress)) {
            return false;
        }
        if (fixedPeers
            .map(utils_1.constructPeerIdFromPeerInfo)
            .includes(utils_1.constructPeerIdFromPeerInfo(peerInfo))) {
            return false;
        }
        if (seedPeers
            .map(utils_1.constructPeerIdFromPeerInfo)
            .includes(utils_1.constructPeerIdFromPeerInfo(peerInfo))) {
            return false;
        }
        return true;
    });
    const previousPeers = lists.previousPeers.filter(peerInfo => {
        if (peerInfo.ipAddress === nodeInfo.ipAddress) {
            return false;
        }
        if (blacklistedIPs.includes(peerInfo.ipAddress)) {
            return false;
        }
        return true;
    });
    return {
        blacklistedPeers,
        seedPeers,
        fixedPeers,
        whitelisted,
        previousPeers,
    };
};
//# sourceMappingURL=validation.js.map